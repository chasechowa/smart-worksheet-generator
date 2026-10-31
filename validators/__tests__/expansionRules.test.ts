import { describe, expect, it } from 'vitest';
import { EXPANSION_LEVEL_RULES, findExpansionLevelProblems, findExpansionContinuationProblems } from '../expansionRules';
import { findExpansionProblems } from '../writingValidator';
import type { ExpansionItem } from '../../types';

function makeItem(overrides: Partial<ExpansionItem> = {}): ExpansionItem {
  return {
    id: 'e1',
    fact: 'The new suit compresses the swimmer’s muscles and reduces drag in the water',
    conjunctions: ['whereas', 'provided that', 'as a result'],
    continuations: [
      { connector: 'whereas', continuation: 'older suits mainly increased buoyancy' },
      { connector: 'provided that', continuation: 'the swimmer keeps a streamlined posture' },
      { connector: 'as a result', continuation: 'elite races became noticeably faster' },
    ],
    sampleAnswer: 'The new suit compresses the swimmer’s muscles and reduces drag in the water, so elite races became faster.',
    ...overrides,
  };
}

describe('level guidance', () => {
  it('keeps word bands as soft targets, not connector whitelists', () => {
    const fact = 'This new machine helps people work much faster and it is also very easy to use every day';
    const problems = findExpansionLevelProblems(makeItem({ fact }), 'A2');
    expect(problems.some(problem => /A2 target is 6-16 words/.test(problem))).toBe(true);
    expect(EXPANSION_LEVEL_RULES.A2.functions).toContain('time');
    expect(EXPANSION_LEVEL_RULES.C1.functions).toContain('extent');
    expect(EXPANSION_LEVEL_RULES.C1.examples).toContain('insofar as');
  });

  it('accepts three connectors and three continuations', () => {
    expect(findExpansionContinuationProblems(makeItem())).toEqual([]);
    expect(findExpansionProblems(makeItem())).toEqual([]);
  });

  it('requires one continuation per connector', () => {
    const problems = findExpansionContinuationProblems(makeItem({ continuations: undefined }));
    expect(problems.some(problem => /one continuation per connector/.test(problem))).toBe(true);
  });

  it('flags a continuation that does not match its connector', () => {
    const problems = findExpansionContinuationProblems(makeItem({
      continuations: [
        { connector: 'whereas', continuation: 'older suits mainly increased buoyancy' },
        { connector: 'whereas', continuation: 'the swimmer keeps a streamlined posture' },
        { connector: 'as a result', continuation: 'elite races became noticeably faster' },
      ],
    }));
    expect(problems.some(problem => /missing continuation for "provided that"/.test(problem))).toBe(true);
  });

  it('flags a continuation longer than the fact itself is allowed to be', () => {
    const problems = findExpansionContinuationProblems(makeItem({
      continuations: [
        { connector: 'whereas', continuation: 'x' },
        { connector: 'provided that', continuation: 'the swimmer keeps a streamlined posture' },
        { connector: 'as a result', continuation: 'elite races became noticeably faster' },
      ],
    }));
    expect(problems.some(problem => /too short/.test(problem))).toBe(true);
  });
});
