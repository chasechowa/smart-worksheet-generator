import { describe, expect, it } from 'vitest';
import { EXPANSION_LEVEL_RULES, findExpansionLevelProblems } from '../expansionRules';
import type { ExpansionItem } from '../../types';

function makeItem(fact: string, conjunctions: string[]): ExpansionItem {
  return { id: 'e1', fact, conjunctions, sampleAnswer: '' };
}

describe('findExpansionLevelProblems', () => {
  it('rejects an A2 fact that is too long', () => {
    const fact = 'This new machine helps people work much faster and it is also very easy to use every day';
    const problems = findExpansionLevelProblems(makeItem(fact, ['because', 'so', 'but']), 'A2');
    expect(problems.some(problem => /A2 expects 6-14 words/.test(problem))).toBe(true);
  });

  it('rejects connectors above the selected level', () => {
    const problems = findExpansionLevelProblems(
      makeItem('The machine helps people work faster.', ['notwithstanding', 'whereas', 'insofar as']),
      'A2',
    );
    expect(problems.some(problem => /not A2-appropriate/.test(problem))).toBe(true);
  });

  it('accepts a B2 item with B2 connectors inside the word band', () => {
    const fact = 'The new suit compresses the swimmer’s muscles and reduces drag in the water';
    const problems = findExpansionLevelProblems(
      makeItem(fact, ['whereas', 'provided that', 'as a result']),
      'B2',
    );
    expect(problems).toEqual([]);
  });

  it('accepts C1 academic connectors', () => {
    const problems = findExpansionLevelProblems(
      makeItem('Systemic risk in the housing market grew quietly over the following decade after the policy change', ['insofar as', 'whereas', 'thereby']),
      'C1',
    );
    expect(problems).toEqual([]);
  });

  it('requires exactly three connectors', () => {
    const problems = findExpansionLevelProblems(makeItem('A short fact about the topic', ['because', 'so']), 'B1');
    expect(problems.some(problem => /exactly 3 connectors/.test(problem))).toBe(true);
  });

  it('exposes distinct pools per level', () => {
    expect(EXPANSION_LEVEL_RULES.A2.connectors).toContain('because');
    expect(EXPANSION_LEVEL_RULES.A2.connectors).not.toContain('insofar as');
    expect(EXPANSION_LEVEL_RULES.C1.connectors).toContain('insofar as');
    expect(EXPANSION_LEVEL_RULES.B2.connectors).toContain('provided that');
  });
});
