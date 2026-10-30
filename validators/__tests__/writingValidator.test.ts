import { describe, expect, it } from 'vitest';
import { findExpansionFactProblems, findInvalidExpansionIds, validateWriting } from '../writingValidator';
import type { ExpansionItem, WorksheetData } from '../../types';

function makeExpansion(overrides: Partial<ExpansionItem> = {}): ExpansionItem {
  return {
    id: 'e1',
    fact: 'VR lets Olympic skiers practise a course repeatedly without the danger of falling.',
    conjunctions: ['so that', 'although', 'unless'],
    sampleAnswer: 'VR lets Olympic skiers practise a course repeatedly without the danger of falling, so that their performance becomes smoother.',
    ...overrides,
  };
}

function makeData(expansion: ExpansionItem[]): WorksheetData {
  return {
    title: 'T',
    articleSnippet: 's',
    summary: { paragraph: '', blanks: [] },
    multipleChoice: [],
    syntaxDeconstruction: [],
    writingWorkshop: {
      expansion,
      keywords: ['one', 'two', 'three', 'four', 'five'],
      qaChain: ['Q1?', 'Q2?', 'Q3?', 'Q4?'],
      criticalThinking: 'Evaluate the claim.',
    },
    keys: { summary: [], mc: {}, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
  };
}

describe('findExpansionFactProblems', () => {
  it('accepts a single-clause fact', () => {
    expect(findExpansionFactProblems(makeExpansion().fact, makeExpansion().conjunctions)).toEqual([]);
  });

  it('rejects a fact that already contains a result clause', () => {
    const fact = 'VR lets skiers practise repeatedly, so their performance becomes smooth.';
    expect(findExpansionFactProblems(fact, ['so that', 'although']).join(' ')).toMatch(/so/);
  });

  it('rejects a fact that already contains a contrast clause', () => {
    const fact = 'Jesse Owens ran on a cinder track, while Usain Bolt ran on a rubber track.';
    expect(findExpansionFactProblems(fact, ['whereas', 'therefore']).join(' ')).toMatch(/while/);
  });

  it('rejects a fact that joins two clauses with a comma coordinator', () => {
    const fact = 'The bicycle reduced wind resistance, and the record went five miles farther.';
    expect(findExpansionFactProblems(fact, ['because', 'moreover']).join(' ')).toMatch(/and/);
  });

  it('rejects a fact that already contains an offered connector', () => {
    const fact = 'The fabric compresses muscles because it is tight.';
    expect(findExpansionFactProblems(fact, ['because', 'although']).join(' ')).toMatch(/offered conjunction/i);
  });
});

describe('findInvalidExpansionIds', () => {
  it('returns only the unusable items', () => {
    const items = [
      makeExpansion({ id: 'e1' }),
      makeExpansion({ id: 'e2', fact: 'The suit compresses muscles, so swimmers go faster.' }),
    ];
    expect(findInvalidExpansionIds(items)).toEqual(['e2']);
  });
});

describe('validateWriting expansion warnings', () => {
  it('warns when the fact already contains the logical link', () => {
    const items = [
      makeExpansion({ id: 'e1' }),
      makeExpansion({ id: 'e2' }),
      makeExpansion({ id: 'e3' }),
      makeExpansion({ id: 'e4', fact: 'The suit compresses muscles, so swimmers go faster.' }),
    ];
    const issues = validateWriting(makeData(items), 'article text');
    const warnings = issues.filter(issue => issue.section === 'writing' && issue.severity === 'warning');
    expect(warnings.some(issue => /nothing to expand/i.test(issue.message))).toBe(true);
  });

  it('warns when the fact is too long for A2', () => {
    const fact = 'This new machine helps people work much faster and it is also very easy to use every day';
    const items = ['e1', 'e2', 'e3', 'e4'].map(id => makeExpansion({ id, fact, conjunctions: ['because', 'so', 'but'] }));
    const issues = validateWriting(makeData(items), 'article text', 'A2');
    expect(issues.some(issue => issue.severity === 'warning' && /A2 expects 6-14 words/.test(issue.message))).toBe(true);
  });

  it('warns when the connectors are above the selected level', () => {
    const items = ['e1', 'e2', 'e3', 'e4'].map(id => makeExpansion({
      id,
      fact: 'The machine helps people work faster.',
      conjunctions: ['notwithstanding', 'whereas', 'insofar as'],
    }));
    const issues = validateWriting(makeData(items), 'article text', 'A2');
    expect(issues.some(issue => issue.severity === 'warning' && /not A2-appropriate/.test(issue.message))).toBe(true);
  });
});
