import { describe, it, expect } from 'vitest';
import { validateKeys } from '../keysValidator';
import type { WorksheetData } from '../../types';

function createData(overrides: Partial<WorksheetData> = {}): WorksheetData {
  return {
    title: 'Test',
    articleSnippet: 'snippet',
    summary: { paragraph: 'Test [BLANK] text', blanks: ['word'] },
    multipleChoice: [
      { id: 'q1', type: 'Literal Comprehension', question: 'Q1?', options: ['A1', 'B1', 'C1', 'D1'], answer: 'A', explanation: 'ok' },
      { id: 'q2', type: 'Inference', question: 'Q2?', options: ['A2', 'B2', 'C2', 'D2'], answer: 'B', explanation: 'ok' },
    ],
    syntaxDeconstruction: [{ id: 's1', original: 'Hello world.', answer: 'Hello. World.' }],
    writingWorkshop: { expansion: [{ id: 'e1', fact: 'F1', conjunctions: ['and'], sampleAnswer: 'A' }], keywords: ['k1'], qaChain: ['Q?'], criticalThinking: 'Think.' },
    keys: {
      summary: ['word'],
      mc: { q1: 'A', q2: 'B' },
      syntaxDeconstruction: ['Hello. World.'],
      expansion: ['A'],
      qa: ['Answer'],
      critical: 'Guidance',
    },
    ...overrides,
  };
}

describe('validateKeys', () => {
  it('detects missing keys section', () => {
    const issues = validateKeys(createData({ keys: undefined as any }));
    expect(issues.some(i => i.message.includes('Keys section is missing'))).toBe(true);
  });

  it('detects non A-D MC key', () => {
    const issues = validateKeys(createData({
      keys: { summary: [], mc: { q1: 'X', q2: 'B' }, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
    }));
    expect(issues.some(i => i.message.includes('MC key for q1 is "X"'))).toBe(true);
  });

  it('detects key letter mismatch with answer field (key says A but answer says B)', () => {
    const data = createData();
    data.multipleChoice[0].answer = 'B'; // answer is B but key says A
    const issues = validateKeys(data);
    expect(issues.some(i => i.message.includes('MC key for q1') && i.message.includes('answer is B'))).toBe(true);
  });

  it('does not emit false positive for non-letter answers (handled by mcValidator first)', () => {
    // In the real pipeline, mcValidator normalizes answers to letters before keysValidator runs.
    // If called directly with legacy option-text data, keysValidator skips semantic check gracefully.
    const data = createData({
      multipleChoice: [
        { id: 'q1', type: 'Literal Comprehension', question: 'Q1?', options: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Beta', explanation: 'ok' },
      ],
      keys: { summary: [], mc: { q1: 'D' }, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
    });
    const issues = validateKeys(data);
    // 'Beta' is not a valid letter → semantic check is skipped → no MC key issue
    const mcKeyIssues = issues.filter(i => i.section === 'keys' && i.message.startsWith('MC key for'));
    expect(mcKeyIssues.length).toBe(0);
  });

  it('passes when keys match answer letters', () => {
    const data = createData();
    const issues = validateKeys(data);
    const mcKeyIssues = issues.filter(i => i.section === 'keys' && i.message.startsWith('MC key for'));
    expect(mcKeyIssues.length).toBe(0);
  });

  // ---- Regression: expansion and QA key integrity ----

  it('detects mismatched expansion key count', () => {
    // 2 expansion items but only 1 key
    const data = createData({
      writingWorkshop: {
        expansion: [
          { id: 'e1', fact: 'F1', conjunctions: ['and'], sampleAnswer: 'A' },
          { id: 'e2', fact: 'F2', conjunctions: ['but'], sampleAnswer: 'B' },
        ],
        keywords: ['k1'],
        qaChain: ['Q?'],
        criticalThinking: 'Think.',
      },
      keys: { summary: [], mc: { q1: 'A', q2: 'B' }, syntaxDeconstruction: [], expansion: ['A'], qa: ['Answer'], critical: '' },
    });
    const issues = validateKeys(data);
    expect(issues.some(i => i.message.includes('Expansion key count'))).toBe(true);
  });

  it('detects mismatched QA key count', () => {
    // 2 QA questions but only 1 answer key
    const data = createData({
      writingWorkshop: {
        expansion: [{ id: 'e1', fact: 'F1', conjunctions: ['and'], sampleAnswer: 'A' }],
        keywords: ['k1'],
        qaChain: ['Q1?', 'Q2?'],
        criticalThinking: 'Think.',
      },
      keys: { summary: [], mc: { q1: 'A', q2: 'B' }, syntaxDeconstruction: [], expansion: ['A'], qa: ['OnlyOne'], critical: '' },
    });
    const issues = validateKeys(data);
    expect(issues.some(i => i.message.includes('Q&A key count'))).toBe(true);
  });

  it('passes with complete keys including expansion and QA', () => {
    const data = createData({
      writingWorkshop: {
        expansion: [
          { id: 'e1', fact: 'F1', conjunctions: ['and'], sampleAnswer: 'A' },
          { id: 'e2', fact: 'F2', conjunctions: ['but'], sampleAnswer: 'B' },
        ],
        keywords: ['k1', 'k2'],
        qaChain: ['Q1?', 'Q2?', 'Q3?'],
        criticalThinking: 'Think.',
      },
      keys: {
        summary: ['word'],
        mc: { q1: 'A', q2: 'B' },
        syntaxDeconstruction: ['Hello. World.'],
        expansion: ['A', 'B'],
        qa: ['Ans1', 'Ans2', 'Ans3'],
        critical: 'Guidance',
      },
    });
    const issues = validateKeys(data);
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });
});

describe('validateKeys — sentence insertion', () => {
  const items = [
    { id: 'si1', sentence: 'S1', paragraph: 'Aaa.[1] Bbb.[2] Ccc.[3] Ddd.[4]', answer: 2 },
    { id: 'si2', sentence: 'S2', paragraph: 'Eee.[1] Fff.[2] Ggg.[3] Hhh.[4]', answer: 3 },
  ];

  it('emits nothing when the section is absent', () => {
    const issues = validateKeys(createData());
    expect(issues.some(i => i.message.includes('Sentence insertion'))).toBe(false);
  });

  it('accepts matching keys', () => {
    const issues = validateKeys(createData({
      sentenceInsertion: items as any,
      keys: { summary: [], mc: {}, sentenceInsertion: { si1: 2, si2: 3 }, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
    }));
    expect(issues.filter(i => i.message.includes('Sentence insertion'))).toHaveLength(0);
  });

  it('detects a count mismatch', () => {
    const issues = validateKeys(createData({
      sentenceInsertion: items as any,
      keys: { summary: [], mc: {}, sentenceInsertion: { si1: 2 }, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
    }));
    expect(issues.some(i => i.message.includes('Sentence insertion key count (1) does not match item count (2)'))).toBe(true);
  });

  it('detects an out-of-range key and a mismatch with the item answer', () => {
    const issues = validateKeys(createData({
      sentenceInsertion: items as any,
      keys: { summary: [], mc: {}, sentenceInsertion: { si1: 9, si2: 1 }, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
    }));
    expect(issues.some(i => i.message.includes('expected a position 1-4'))).toBe(true);
    expect(issues.some(i => i.message.includes("key for si2 is 1") && i.message.includes('answer is 3'))).toBe(true);
  });
});
