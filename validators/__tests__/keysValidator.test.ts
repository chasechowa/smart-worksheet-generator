import { describe, it, expect } from 'vitest';
import { validateKeys } from '../keysValidator';
import type { WorksheetData } from '../../types';

function createData(overrides: Partial<WorksheetData> = {}): WorksheetData {
  return {
    title: 'Test',
    articleSnippet: 'snippet',
    summary: { paragraph: 'Test [BLANK] text', blanks: ['word'] },
    multipleChoice: [
      { id: 'q1', type: 'Main Idea', question: 'Q1?', options: ['A1', 'B1', 'C1', 'D1'], answer: 'A', explanation: 'ok' },
      { id: 'q2', type: 'Detail & Inference', question: 'Q2?', options: ['A2', 'B2', 'C2', 'D2'], answer: 'B', explanation: 'ok' },
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

  it('detects key mismatch when answer is option text', () => {
    const data = createData({
      multipleChoice: [
        { id: 'q1', type: 'Main Idea', question: 'Q1?', options: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Beta', explanation: 'ok' },
      ],
      keys: { summary: [], mc: { q1: 'D' }, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
    });
    const issues = validateKeys(data);
    expect(issues.some(i => i.message.includes('answer field is "Beta"'))).toBe(true);
  });

  it('passes when keys match answer letters', () => {
    const data = createData();
    const issues = validateKeys(data);
    const mcKeyIssues = issues.filter(i => i.section === 'keys' && i.message.startsWith('MC key for'));
    expect(mcKeyIssues.length).toBe(0);
  });
});
