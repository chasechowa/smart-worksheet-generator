import type { Difficulty, ExpansionItem } from '../types';

/**
 * Level-specific rules for sentence expansion. This is the single source of
 * truth for both the prompt (aiService) and validation (writingValidator), so
 * the fact length and connector pool cannot drift apart.
 */
export interface ExpansionLevelRule {
  /** Allowed word-count band for the one-clause fact. */
  factWords: [number, number];
  /** Allowed word-count band for sampleAnswer. */
  sampleWords: [number, number];
  /** Exactly three connectors are chosen from this pool. */
  connectors: string[];
  /** How complex the fact may be at this level. */
  syntax: string;
}

export const EXPANSION_LEVEL_RULES: Record<Difficulty, ExpansionLevelRule> = {
  A2: {
    factWords: [6, 14],
    sampleWords: [10, 20],
    connectors: ['and', 'but', 'because', 'so', 'then', 'after that', 'when'],
    syntax: 'simple or compound sentence; A1-A2 vocabulary; one short clause in fact',
  },
  B1: {
    factWords: [9, 17],
    sampleWords: [13, 24],
    connectors: ['because', 'although', 'so that', 'if', 'unless', 'while', 'however', 'therefore'],
    syntax: 'at most one subordinate clause; B1 vocabulary',
  },
  B2: {
    factWords: [11, 20],
    sampleWords: [16, 28],
    connectors: ['although', 'whereas', 'because', 'so that', 'unless', 'provided that', 'therefore', 'as a result', 'in contrast', 'consequently'],
    syntax: 'precise B2 vocabulary; one independent clause in fact',
  },
  C1: {
    factWords: [14, 24],
    sampleWords: [20, 34],
    connectors: ['whereas', 'even though', 'unless', 'provided that', 'thereby', 'consequently', 'by contrast', 'insofar as'],
    syntax: 'abstract or nominalized C1 wording; one independent clause in fact',
  },
};

export function countExpansionWords(text: string): number {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function getExpansionLevelGuidance(difficulty: Difficulty): string {
  const rule = EXPANSION_LEVEL_RULES[difficulty];
  return `fact: ${rule.factWords[0]}-${rule.factWords[1]} words; ${rule.syntax}. ` +
    `connectors: choose exactly 3 from: ${rule.connectors.join(' / ')}. ` +
    `sampleAnswer: ${rule.sampleWords[0]}-${rule.sampleWords[1]} words.`;
}

export function findExpansionLevelProblems(item: ExpansionItem, difficulty: Difficulty): string[] {
  const rule = EXPANSION_LEVEL_RULES[difficulty];
  const problems: string[] = [];

  const words = countExpansionWords(item.fact);
  if (words < rule.factWords[0] || words > rule.factWords[1]) {
    problems.push(`fact is ${words} words; ${difficulty} expects ${rule.factWords[0]}-${rule.factWords[1]} words`);
  }

  const connectors = (item.conjunctions || [])
    .map(connector => String(connector ?? '').trim().toLowerCase())
    .filter(Boolean);
  const disallowed = connectors.filter(connector => !rule.connectors.includes(connector));
  if (disallowed.length > 0) {
    problems.push(`connector "${disallowed[0]}" is not ${difficulty}-appropriate`);
  }
  if (connectors.length !== 3) {
    problems.push(`needs exactly 3 connectors, got ${connectors.length}`);
  }

  return problems;
}
