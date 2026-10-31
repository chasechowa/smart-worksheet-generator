import type { Difficulty, ExpansionItem } from '../types';

/**
 * Level guidance for sentence expansion.
 *
 * These are SOFT targets: the fact and its continuations are judged by whether
 * a natural continuation exists, not by a connector whitelist. The functions
 * and examples below are a menu the model may choose from; exact wording can
 * vary with the fact.
 */
export interface ExpansionLevelRule {
  factWords: [number, number];
  continuationWords: [number, number];
  /** Logical relations worth mixing at this level. */
  functions: string[];
  /** Example connectors, not a whitelist. */
  examples: string;
  syntax: string;
}

const BASE_FUNCTIONS = ['addition', 'contrast', 'cause', 'result', 'time'];

export const EXPANSION_LEVEL_RULES: Record<Difficulty, ExpansionLevelRule> = {
  A2: {
    factWords: [6, 16],
    continuationWords: [6, 14],
    functions: BASE_FUNCTIONS,
    examples: 'and, also, but, because, so, then, when, after that',
    syntax: 'simple or compound sentence; A1-A2 vocabulary',
  },
  B1: {
    factWords: [8, 18],
    continuationWords: [7, 16],
    functions: [...BASE_FUNCTIONS, 'purpose', 'condition', 'example'],
    examples: 'and, but, because, so, although, if, unless, so that, for example',
    syntax: 'at most one subordinate clause; B1 vocabulary',
  },
  B2: {
    factWords: [10, 22],
    continuationWords: [8, 18],
    functions: [...BASE_FUNCTIONS, 'purpose', 'condition', 'example', 'concession', 'qualification', 'alternative'],
    examples: 'whereas, even though, provided that, however, therefore, as a result, in contrast, on the other hand',
    syntax: 'precise B2 vocabulary; fact stays one independent clause',
  },
  C1: {
    factWords: [12, 26],
    continuationWords: [10, 22],
    functions: [...BASE_FUNCTIONS, 'purpose', 'condition', 'example', 'concession', 'qualification', 'alternative', 'extent', 'hypothetical'],
    examples: 'insofar as, to the extent that, albeit, notwithstanding, even if, thereby, by contrast',
    syntax: 'abstract or nominalized C1 wording; nuanced stance; one independent clause in fact',
  },
};

export function countExpansionWords(text: string): number {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getExpansionLevelGuidance(difficulty: Difficulty): string {
  const rule = EXPANSION_LEVEL_RULES[difficulty];
  return `fact ${rule.factWords[0]}-${rule.factWords[1]} words (target); ${rule.syntax}. ` +
    `Each continuation ${rule.continuationWords[0]}-${rule.continuationWords[1]} words. ` +
    `Mix logical functions: ${rule.functions.join(', ')}. ` +
    `Connector examples (not a whitelist — choose whatever fits the fact): ${rule.examples}.`;
}

/** Advisory only: word-count targets, not connector identity. */
export function findExpansionLevelProblems(item: ExpansionItem, difficulty: Difficulty): string[] {
  const rule = EXPANSION_LEVEL_RULES[difficulty];
  const problems: string[] = [];

  const factWords = countExpansionWords(item.fact);
  if (factWords < rule.factWords[0] || factWords > rule.factWords[1]) {
    problems.push(`fact is ${factWords} words; ${difficulty} target is ${rule.factWords[0]}-${rule.factWords[1]} words`);
  }

  for (const continuation of item.continuations || []) {
    const words = countExpansionWords(continuation.continuation);
    if (words < rule.continuationWords[0] || words > rule.continuationWords[1]) {
      problems.push(`continuation for "${continuation.connector}" is ${words} words; ${difficulty} target is ${rule.continuationWords[0]}-${rule.continuationWords[1]} words`);
    }
  }

  return problems;
}

/**
 * Structural proof that every offered connector has a natural continuation.
 * These ARE blocking for regeneration: a connector without a continuation is
 * exactly the "student cannot continue this" failure.
 */
export function findExpansionContinuationProblems(item: ExpansionItem): string[] {
  const problems: string[] = [];
  const connectors = (item.conjunctions || []).map(normalize).filter(Boolean);

  if (connectors.length !== 3) {
    problems.push(`needs exactly 3 connectors, got ${connectors.length}`);
  }
  if (new Set(connectors).size !== connectors.length) {
    problems.push('connectors must be distinct');
  }

  const continuations = Array.isArray(item.continuations) ? item.continuations : [];
  if (continuations.length !== 3) {
    problems.push(`needs one continuation per connector (3), got ${continuations.length}`);
  }

  for (const connector of connectors) {
    const match = continuations.find(candidate => normalize(candidate.connector) === connector);
    if (!match) {
      problems.push(`missing continuation for "${connector}"`);
      continue;
    }
    const text = String(match.continuation ?? '').trim();
    if (countExpansionWords(text) < 3) {
      problems.push(`continuation for "${connector}" is too short`);
      continue;
    }
    if (text && normalize(item.fact).includes(normalize(text))) {
      problems.push(`continuation for "${connector}" repeats the fact`);
    }
  }

  // The model answer must demonstrate ONE choice, not chain all three together.
  const sampleAnswer = String(item.sampleAnswer ?? '');
  if (sampleAnswer) {
    const used = connectors.filter(connector =>
      new RegExp(`\\b${escapeRegExp(connector)}\\b`, 'i').test(sampleAnswer),
    );
    if (used.length > 1) {
      problems.push(`sampleAnswer uses more than one offered connector (${used.join(', ')}); each model answer must use exactly one`);
    }
  }

  return problems;
}
