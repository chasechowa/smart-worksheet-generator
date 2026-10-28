import type { WorksheetData, ValidationIssue, MCQuestion, MCQuestionType, CognitiveLevel, DistractorPattern, Difficulty } from '../types';

const EXPECTED_MC_COUNT = 10;

// Default type distribution (exact counts)
const DEFAULT_EXPECTED_TYPE_COUNTS: Record<MCQuestionType, number> = {
  'Main Idea': 1,
  'Literal Comprehension': 2,
  'Inference': 3,
  'Evidence Reasoning': 2,
  'Vocabulary in Context': 1,
  'Structure / Function / Synthesis': 1,
};

const C1_EXPECTED_TYPE_COUNTS: Record<MCQuestionType, number> = {
  'Main Idea': 1,
  'Literal Comprehension': 0,
  'Inference': 4,
  'Evidence Reasoning': 2,
  'Vocabulary in Context': 1,
  'Structure / Function / Synthesis': 2,
};

const B2_EXPECTED_TYPE_COUNTS: Record<MCQuestionType, number> = {
  'Main Idea': 1,
  'Literal Comprehension': 1,
  'Inference': 3,
  'Evidence Reasoning': 2,
  'Vocabulary in Context': 1,
  'Structure / Function / Synthesis': 2,
};

const A2_EXPECTED_TYPE_COUNTS: Record<MCQuestionType, number> = {
  'Main Idea': 1,
  'Literal Comprehension': 6,
  'Inference': 1,
  'Evidence Reasoning': 0,
  'Vocabulary in Context': 1,
  'Structure / Function / Synthesis': 1,
};

const B1_EXPECTED_TYPE_COUNTS: Record<MCQuestionType, number> = {
  'Main Idea': 1,
  'Literal Comprehension': 4,
  'Inference': 3,
  'Evidence Reasoning': 0,
  'Vocabulary in Context': 1,
  'Structure / Function / Synthesis': 1,
};

function getExpectedTypeCounts(difficulty?: Difficulty): Record<MCQuestionType, number> {
  if (difficulty === 'A2') return A2_EXPECTED_TYPE_COUNTS;
  if (difficulty === 'B1') return B1_EXPECTED_TYPE_COUNTS;
  if (difficulty === 'B2') return B2_EXPECTED_TYPE_COUNTS;
  if (difficulty === 'C1') return C1_EXPECTED_TYPE_COUNTS;
  return DEFAULT_EXPECTED_TYPE_COUNTS;
}

const ALLOWED_TYPES: MCQuestionType[] = Object.keys(DEFAULT_EXPECTED_TYPE_COUNTS) as MCQuestionType[];

const ALLOWED_PATTERNS: DistractorPattern[] = [
  'Too Broad', 'Too Narrow', 'Too Strong', 'Partially True',
  'Wrong Scope', 'Unsupported Inference', 'Reversed Logic',
];

const DISTRACTOR_PATTERN_MIGRATION: Record<string, DistractorPattern> = {
  'broad': 'Too Broad',
  'too broad': 'Too Broad',
  'overgeneralization': 'Too Broad',
  'overgeneralisation': 'Too Broad',
  'narrow': 'Too Narrow',
  'too narrow': 'Too Narrow',
  'irrelevant detail': 'Too Narrow',
  'overstatement': 'Too Strong',
  'overreach': 'Too Strong',
  'too strong': 'Too Strong',
  'counterfactual unlikely': 'Too Strong',
  'partially true': 'Partially True',
  'fact not flaw': 'Partially True',
  'fact, not flaw': 'Partially True',
  'implied not primary': 'Partially True',
  'implied, not primary': 'Partially True',
  'wrong scope': 'Wrong Scope',
  'wrong focus': 'Wrong Scope',
  'wrong emphasis': 'Wrong Scope',
  'no contrast': 'Wrong Scope',
  'definitional': 'Wrong Scope',
  'unsupported': 'Unsupported Inference',
  'unsupported inference': 'Unsupported Inference',
  'no evidence': 'Unsupported Inference',
  'irrelevant': 'Unsupported Inference',
  'contradiction': 'Reversed Logic',
  'reversed logic': 'Reversed Logic',
  'causality reversal': 'Reversed Logic',
};

// Old → new type migration (backward compat for saved worksheets)
const TYPE_MIGRATION: Record<string, MCQuestionType> = {
  // Old pre-v2 types:
  'Detail & Inference': 'Inference',
  'Finding Evidence': 'Evidence Reasoning',
  'Function/Tone': 'Structure / Function / Synthesis',
  'Paraphrase': 'Inference',
  'Rhetorical Function': 'Structure / Function / Synthesis',
  'Text Structure': 'Structure / Function / Synthesis',
  'Synthesis': 'Structure / Function / Synthesis',
  // New types that map to self:
  // 'Main Idea', 'Literal Comprehension', 'Vocabulary in Context' stay the same
};

// ---------------------------------------------------------------------------
// Enum canonicalization — single source of truth for slot metadata
// ---------------------------------------------------------------------------
//
// Models regularly vary casing and spacing ("Inference", "Evidence Reasoning ",
// "Structure/Function/Synthesis", "Whole Text"). Generation-side checks already
// accepted those variants, but validateMC compared by exact string, so a
// correctly generated B2 worksheet could still fail validation forever.

function normalizeEnumKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TYPE_BY_NORMALIZED_KEY: Record<string, MCQuestionType> = Object.fromEntries(
  ALLOWED_TYPES.map(type => [normalizeEnumKey(type), type]),
) as Record<string, MCQuestionType>;

/** Canonical challenge type, tolerating case/spacing and legacy aliases. */
export function canonicalMCQuestionType(value: unknown): MCQuestionType | null {
  const key = normalizeEnumKey(value);
  if (!key) return null;
  const direct = TYPE_BY_NORMALIZED_KEY[key];
  if (direct) return direct;
  for (const [legacy, target] of Object.entries(TYPE_MIGRATION)) {
    if (normalizeEnumKey(legacy) === key) return target;
  }
  return null;
}

const COGNITIVE_LEVEL_VALUES: CognitiveLevel[] = ['retrieval', 'inference', 'synthesis'];

const COGNITIVE_LEVEL_ALIASES: Record<string, CognitiveLevel> = {
  inferential: 'inference',
  literal: 'retrieval',
};

/** Canonical cognitive level ("Inference" → "inference"). */
export function canonicalCognitiveLevel(value: unknown): CognitiveLevel | null {
  const key = normalizeEnumKey(value);
  if (!key) return null;
  const direct = COGNITIVE_LEVEL_VALUES.find(level => level === key);
  return direct ?? COGNITIVE_LEVEL_ALIASES[key] ?? null;
}

const SCOPE_ALIASES: Record<string, NonNullable<MCQuestion['scope']>> = {
  'single paragraph': 'single-paragraph',
  'one paragraph': 'single-paragraph',
  'cross paragraph': 'cross-paragraph',
  'multi paragraph': 'cross-paragraph',
  'multiple paragraphs': 'cross-paragraph',
  'two paragraphs': 'cross-paragraph',
  'whole text': 'whole-text',
  'whole passage': 'whole-text',
  'whole article': 'whole-text',
  'entire text': 'whole-text',
  'entire passage': 'whole-text',
};

/** Canonical reading scope ("Whole Text" → "whole-text"). */
export function canonicalMCScope(value: unknown): NonNullable<MCQuestion['scope']> | null {
  const key = normalizeEnumKey(value);
  if (!key) return null;
  return SCOPE_ALIASES[key] ?? null;
}

/**
 * Fixed B2 blueprint, shared by the prompt/retry logic (aiService) and the
 * validator. Keep this as the ONLY definition so the two cannot drift.
 */
export const B2_MC_SLOT_RULES: Record<
  number,
  { type: MCQuestionType; level: CognitiveLevel; scope: NonNullable<MCQuestion['scope']> }
> = {
  1: { type: 'Main Idea', level: 'synthesis', scope: 'whole-text' },
  2: { type: 'Literal Comprehension', level: 'retrieval', scope: 'single-paragraph' },
  3: { type: 'Inference', level: 'inference', scope: 'single-paragraph' },
  4: { type: 'Inference', level: 'inference', scope: 'cross-paragraph' },
  5: { type: 'Inference', level: 'synthesis', scope: 'whole-text' },
  6: { type: 'Evidence Reasoning', level: 'inference', scope: 'cross-paragraph' },
  7: { type: 'Evidence Reasoning', level: 'inference', scope: 'cross-paragraph' },
  8: { type: 'Structure / Function / Synthesis', level: 'synthesis', scope: 'whole-text' },
  9: { type: 'Vocabulary in Context', level: 'inference', scope: 'single-paragraph' },
  10: { type: 'Structure / Function / Synthesis', level: 'synthesis', scope: 'whole-text' },
};

export const B2_REASONING_SLOTS = new Set([1, 3, 4, 5, 6, 7, 8, 10]);

export function getB2SlotNumber(id: unknown): number | null {
  const match = /^q(\d+)$/i.exec(String(id ?? '').trim());
  return match ? Number(match[1]) : null;
}

/**
 * The fixed B2 blueprint decides what each slot assesses; item metadata is the
 * model's self-report and must not block a worksheet. Align the metadata to the
 * blueprint and surface any real disagreement as a warning.
 */
function alignB2SkillSlots(questions: MCQuestion[], issues: ValidationIssue[]): MCQuestion[] {
  return questions.map(question => {
    const slot = getB2SlotNumber(question.id);
    const rule = slot === null ? undefined : B2_MC_SLOT_RULES[slot];
    if (!rule) return question;

    const type = canonicalMCQuestionType(question.type) ?? question.type;
    const level = question.cognitiveLevel;
    const scope = question.scope;
    if (type === rule.type && level === rule.level && scope === rule.scope) {
      return { ...question, type: rule.type, cognitiveLevel: rule.level, scope: rule.scope };
    }

    issues.push({
      type: 'rule', section: 'mc', severity: 'warning',
      message: `${question.id}: skill slot metadata auto-aligned to the fixed B2 blueprint`,
      suggestion: `Was ${type} / ${level ?? 'missing'} / ${scope ?? 'missing'}; now ${rule.type} / ${rule.level} / ${rule.scope}.`,
    });
    return { ...question, type: rule.type, cognitiveLevel: rule.level, scope: rule.scope };
  });
}

export function stripPrefix(text: string): string {
  return String(text ?? '').replace(/^[A-Da-d][.)\]]\s*/, '').replace(/^\d+[.)\]]\s*/, '').trim();
}

/** Canonical answer letter: trims, uppercases, and tolerates trailing "." or ")". */
export function normalizeAnswerToken(answer: unknown): string {
  return String(answer ?? '').trim().toUpperCase().replace(/[.)\]](?=\s*$)/, '').trim();
}

// ---------------------------------------------------------------------------
// Option length parity (correct-answer-relative, measured in words)
// ---------------------------------------------------------------------------

/** Maximum allowed word-count difference between a distractor and the correct option. */
export const OPTION_LENGTH_TOLERANCE_WORDS = 2;

export interface OptionWordCount {
  index: number;
  letter: string;
  words: number;
  isCorrect: boolean;
}

export interface OptionLengthViolation {
  index: number;
  letter: string;
  words: number;
  correctLetter: string;
  correctWords: number;
  difference: number;
}

export function countOptionWords(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Word counts for a well-formed 4-option question, or null when the options or
 * answer are malformed (structural errors already cover those cases).
 */
export function getOptionWordCounts(
  options: string[] | null | undefined,
  answer: string | null | undefined,
): OptionWordCount[] | null {
  if (!Array.isArray(options) || options.length !== 4) return null;
  const correctLetter = String(answer ?? '').trim().toUpperCase();
  if (!/^[A-D]$/.test(correctLetter)) return null;
  return options.map((option, index) => ({
    index,
    letter: String.fromCharCode(65 + index),
    words: countOptionWords(option),
    isCorrect: String.fromCharCode(65 + index) === correctLetter,
  }));
}

/**
 * Every distractor whose word count differs from the correct option by more
 * than `tolerance`. Empty options are skipped — they are structural errors.
 */
export function getOptionLengthViolations(
  options: string[] | null | undefined,
  answer: string | null | undefined,
  tolerance: number = OPTION_LENGTH_TOLERANCE_WORDS,
): OptionLengthViolation[] {
  const counts = getOptionWordCounts(options, answer);
  if (!counts) return [];
  const correct = counts.find(entry => entry.isCorrect);
  if (!correct || correct.words === 0) return [];

  const violations: OptionLengthViolation[] = [];
  for (const entry of counts) {
    if (entry.isCorrect || entry.words === 0) continue;
    const difference = Math.abs(entry.words - correct.words);
    if (difference > tolerance) {
      violations.push({
        index: entry.index,
        letter: entry.letter,
        words: entry.words,
        correctLetter: correct.letter,
        correctWords: correct.words,
        difference,
      });
    }
  }
  return violations;
}

export function isOptionLengthBalanced(
  options: string[] | null | undefined,
  answer: string | null | undefined,
  tolerance: number = OPTION_LENGTH_TOLERANCE_WORDS,
): boolean {
  return getOptionLengthViolations(options, answer, tolerance).length === 0;
}

function normalizePatternKey(pattern: string): string {
  return String(pattern || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeDistractorPattern(pattern: string): DistractorPattern | null {
  if (ALLOWED_PATTERNS.includes(pattern as DistractorPattern)) {
    return pattern as DistractorPattern;
  }

  return DISTRACTOR_PATTERN_MIGRATION[normalizePatternKey(pattern)] || null;
}

function inferDistractorPattern(pattern: string): DistractorPattern {
  const normalized = normalizeDistractorPattern(pattern);
  if (normalized) return normalized;

  const key = normalizePatternKey(pattern);
  if (/contradict|opposite|contrary|reversal/.test(key)) return 'Reversed Logic';
  if (/absolute|over|strong|unlikely|counterfactual/.test(key)) return 'Too Strong';
  if (/narrow|specific/.test(key)) return 'Too Narrow';
  if (/partial|fact/.test(key)) return 'Partially True';
  if (/scope|focus|emphasis|tangent|vague|abstract|misattribution/.test(key)) return 'Wrong Scope';
  return 'Unsupported Inference';
}

/**
 * Normalize an MCQ answer to a single letter (A/B/C/D).
 * - If already a letter → returns it uppercased (standard path).
 * - If answer matches option text → returns the corresponding letter (backward compat path).
 * - If answer doesn't match anything → returns null.
 */
function normalizeAnswerLetter(q: MCQuestion): { letter: string; converted: boolean } | null {
  // Standard path: already a single letter
  if (/^[A-D]$/i.test(q.answer?.trim() || '')) {
    return { letter: q.answer!.trim().toUpperCase(), converted: false };
  }

  // Backward compat: answer is option text - try to find matching option
  const cleanAnswer = stripPrefix(q.answer).toLowerCase();
  if (!cleanAnswer) return null;

  const options = Array.isArray(q.options) ? q.options : [];
  const idx = options.findIndex(opt => {
    const cleanOpt = stripPrefix(opt).toLowerCase();
    return cleanOpt === cleanAnswer ||
           String(opt ?? '').toLowerCase().trim() === q.answer?.toLowerCase().trim();
  });

  if (idx >= 0) {
    return { letter: String.fromCharCode(65 + idx), converted: true };
  }

  return null;
}

/**
 * Rotate the options array so the correct answer moves from `fromLetter` to `targetLetter`.
 * Also updates q.answer to reflect the new position.
 */
function rotateOptions(q: MCQuestion, fromLetter: string, targetLetter: string): MCQuestion {
  const fromIdx = fromLetter.charCodeAt(0) - 65;
  const toIdx = targetLetter.charCodeAt(0) - 65;
  const shift = (fromIdx - toIdx + 4) % 4;
  if (shift === 0) return q;
  const rotated = [...q.options.slice(shift), ...q.options.slice(0, shift)];
  const remappedDistractors: MCQuestion['distractors'] = {};

  if (q.distractors) {
    for (const [oldLetter, meta] of Object.entries(q.distractors)) {
      const oldIdx = oldLetter.toUpperCase().charCodeAt(0) - 65;
      if (oldIdx < 0 || oldIdx > 3) continue;
      const newIdx = (oldIdx - shift + 4) % 4;
      const newLetter = String.fromCharCode(65 + newIdx);
      if (newLetter !== targetLetter) {
        remappedDistractors[newLetter] = meta;
      }
    }
  }

  return {
    ...q,
    options: rotated,
    answer: targetLetter,
    distractors: q.distractors
      ? (Object.keys(remappedDistractors).length > 0 ? remappedDistractors : undefined)
      : undefined,
  };
}

function sanitizeDistractors(q: MCQuestion): { question: MCQuestion; removedLetters: string[]; normalizedPatterns: string[] } {
  const correctLetter = q.answer?.toUpperCase();
  if (!correctLetter) {
    return { question: q, removedLetters: [], normalizedPatterns: [] };
  }

  const cleaned: MCQuestion['distractors'] = {};
  const removedLetters: string[] = [];
  const normalizedPatterns: string[] = [];

  for (const [rawLetter, meta] of Object.entries(q.distractors || {})) {
    const letter = rawLetter.toUpperCase();
    const isOptionLetter = /^[A-D]$/.test(letter);
    if (!isOptionLetter || letter === correctLetter) {
      removedLetters.push(letter);
      continue;
    }

    const normalizedPattern = inferDistractorPattern(meta.pattern);
    cleaned[letter] = normalizedPattern !== meta.pattern
      ? { ...meta, pattern: normalizedPattern }
      : meta;

    if (normalizedPattern !== meta.pattern) {
      normalizedPatterns.push(`${letter}: ${meta.pattern} -> ${normalizedPattern}`);
    }
  }

  for (const letter of ['A', 'B', 'C', 'D']) {
    if (letter === correctLetter || cleaned[letter]) continue;
    cleaned[letter] = {
      pattern: 'Unsupported Inference',
      rationale: 'Generated as standard metadata for this wrong option.',
    };
  }

  return {
    question: {
      ...q,
      distractors: cleaned,
    },
    removedLetters,
    normalizedPatterns,
  };
}

function normalizeEvidencePairLinks(mc: MCQuestion[]): MCQuestion[] {
  const evidenceQuestions = mc.filter(q => q.type === 'Evidence Reasoning');
  if (evidenceQuestions.length !== 2) return mc;

  const [first, second] = evidenceQuestions;
  const existingLinks = evidenceQuestions
    .map(q => q.evidencePairLink)
    .filter(Boolean);
  const usableLink = existingLinks.find(link =>
    link!.claimQuestionId !== link!.evidenceQuestionId &&
    evidenceQuestions.some(q => q.id === link!.claimQuestionId) &&
    evidenceQuestions.some(q => q.id === link!.evidenceQuestionId)
  );

  const claimQuestionId = usableLink?.claimQuestionId || first.id;
  const evidenceQuestionId = usableLink?.evidenceQuestionId || second.id;

  return mc.map(q => q.type === 'Evidence Reasoning'
    ? { ...q, evidencePairLink: { claimQuestionId, evidenceQuestionId } }
    : q
  );
}

/**
 * Fix uneven answer distribution by rotating options to shift
 * over-represented letters toward under-represented ones.
 */
function fixAnswerDistribution(mc: MCQuestion[]): MCQuestion[] {
  const dist: Record<string, number[]> = { A: [], B: [], C: [], D: [] };

  mc.forEach((q, i) => {
    const result = normalizeAnswerLetter(q);
    const letter = result?.letter;
    if (letter && dist[letter]) dist[letter].push(i);
  });

  const result = mc.map(q => ({ ...q }));

  // Pass 1: move from over-represented (>3) to under-represented (<2)
  for (let round = 0; round < 4; round++) {
    const over = Object.entries(dist).filter(([_, idxs]) => idxs.length > 3).map(([l]) => l);
    const under = Object.entries(dist).filter(([_, idxs]) => idxs.length < 2).map(([l]) => l);

    if (over.length === 0 || under.length === 0) break;

    const fromLetter = over[0];
    const toLetter = under[0];
    const qIdx = dist[fromLetter]?.pop();
    if (qIdx === undefined) break;

    result[qIdx] = rotateOptions(result[qIdx], fromLetter, toLetter);
    dist[toLetter].push(qIdx);
  }

  // Pass 2: if still unbalanced (e.g. 4-2-2-2), move from over (>3) to least-represented
  for (let round = 0; round < 4; round++) {
    const entries = Object.entries(dist).sort((a, b) => a[1].length - b[1].length);
    const over = entries.filter(([_, idxs]) => idxs.length > 3).map(([l]) => l);
    if (over.length === 0) break;
    const least = entries.filter(([_, idxs]) => idxs.length < 3).map(([l]) => l);
    if (least.length === 0) break;

    const fromLetter = over[0];
    const toLetter = least[0];
    const qIdx = dist[fromLetter]?.pop();
    if (qIdx === undefined) break;

    result[qIdx] = rotateOptions(result[qIdx], fromLetter, toLetter);
    dist[toLetter].push(qIdx);
  }

  return result;
}

export function validateMC(data: WorksheetData, difficulty?: Difficulty): { issues: ValidationIssue[]; fixedData: WorksheetData } {
  const issues: ValidationIssue[] = [];
  const mc = data.multipleChoice || [];
  const expectedTypeCounts = getExpectedTypeCounts(difficulty);

  if (mc.length !== EXPECTED_MC_COUNT) {
    issues.push({
      type: 'rule',
      section: 'mc',
      severity: 'error',
      message: `Expected ${EXPECTED_MC_COUNT} MC questions, got ${mc.length}`,
    });
  }

  const typeCounts: Record<string, number> = {};

  // Step 1: normalise each question
  let fixedMC: MCQuestion[] = mc.map((q, i) => {
    const rawOptions = Array.isArray(q.options) ? q.options : [];
    const fixedQ: MCQuestion = {
      ...q,
      options: rawOptions.map(opt => stripPrefix(opt)),
    };

    if (rawOptions.length !== 4) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `Q${i + 1}: Expected 4 options, got ${rawOptions.length}` });
    }

    const emptyOptions = fixedQ.options.filter(o => !o || o.trim().length === 0);
    if (emptyOptions.length > 0) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `Q${i + 1}: Contains empty option(s)` });
    }

    // Detect duplicate options
    const uniqueOpts = new Set(fixedQ.options.map(o => o.toLowerCase().trim()));
    if (uniqueOpts.size < fixedQ.options.length) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `Q${i + 1}: Contains duplicate option(s)` });
    }

    // Normalize answer to a letter (A/B/C/D). Supports backward compat for old option-text data.
    const normalized = normalizeAnswerLetter(q);
    if (!normalized) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `Q${i + 1}: Answer "${q.answer}" does not match any option` });
      fixedQ.answer = q.answer;
    } else {
      fixedQ.answer = normalized.letter;
      if (normalized.converted) {
        issues.push({ type: 'rule', section: 'mc', severity: 'warning', message: `Q${i + 1}: Answer was option text "${q.answer}" — auto-converted to letter ${normalized.letter}` });
      }
    }

    // Canonicalize type: tolerate case/spacing first, then legacy migration.
    // Pure formatting differences stay silent; real renames keep the warning.
    const canonicalType = canonicalMCQuestionType(q.type);
    if (!canonicalType) {
      fixedQ.type = 'Literal Comprehension';
    } else {
      if (
        canonicalType !== q.type &&
        normalizeEnumKey(canonicalType) !== normalizeEnumKey(q.type)
      ) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'warning',
          message: `Q${i + 1}: Type "${q.type}" auto-migrated to "${canonicalType}"`,
        });
      }
      fixedQ.type = canonicalType;
    }

    // Same tolerance for cognitiveLevel/scope, so a capitalized model response
    // is not reported as a B2 slot violation.
    const canonicalLevel = canonicalCognitiveLevel(q.cognitiveLevel);
    if (canonicalLevel) fixedQ.cognitiveLevel = canonicalLevel;
    const canonicalScope = canonicalMCScope(q.scope);
    if (canonicalScope) fixedQ.scope = canonicalScope;

    // Auto-fill missing explanation
    if (!q.explanation || q.explanation.trim().length === 0) {
      fixedQ.explanation = 'This is the correct answer based on the passage.';
    }

    const sanitized = sanitizeDistractors(fixedQ);
    if (sanitized.removedLetters.length > 0) {
      issues.push({
        type: 'rule',
        section: 'mc',
        severity: 'warning',
        message: `Q${i + 1}: Removed distractor metadata from correct/invalid option(s): ${sanitized.removedLetters.join(', ')}`,
        suggestion: 'Distractor metadata should be attached to wrong options only.',
      });
    }

    return sanitized.question;
  });

  // Step 2: auto-fix answer distribution (rotate options)
  fixedMC = fixAnswerDistribution(fixedMC).map((q, i) => {
    const sanitized = sanitizeDistractors(q);
    if (sanitized.removedLetters.length > 0) {
      issues.push({
        type: 'rule',
        section: 'mc',
        severity: 'warning',
        message: `Q${i + 1}: Removed distractor metadata from correct/invalid option(s) after option rotation: ${sanitized.removedLetters.join(', ')}`,
        suggestion: 'Regenerate or edit distractor metadata so each wrong option has a matching rationale.',
      });
    }
    return sanitized.question;
  });
  fixedMC = normalizeEvidencePairLinks(fixedMC);

  // The B2 blueprint is authoritative: align slot metadata before distribution
  // counts so one capitalized field can never fail an otherwise valid set.
  if (difficulty === 'B2') {
    fixedMC = alignB2SkillSlots(fixedMC, issues);
  }

  // Rebuild keys after rotation — all answers are now normalized letters
  const newKeys: Record<string, string> = {};
  fixedMC.forEach((q) => {
    if (/^[A-D]$/i.test(q.answer)) newKeys[q.id] = q.answer.toUpperCase();
  });

  let fixedData: WorksheetData = {
    ...data,
    multipleChoice: fixedMC,
    keys: data.keys
      ? { ...data.keys, mc: newKeys }
      : { summary: [], mc: newKeys, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
  };

  // Step 3: verify the fixed data
  const distAfter: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };

  fixedMC.forEach((q, i) => {
    const type = q.type as string;
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    if (/^[A-D]$/i.test(q.answer)) distAfter[q.answer.toUpperCase()]++;
  });

  // ---- Type distribution checks (new exact count system) ----
  for (const [typeName, expectedCount] of Object.entries(expectedTypeCounts)) {
    const actual = typeCounts[typeName] || 0;
    if (actual !== expectedCount) {
      issues.push({
        type: 'rule', section: 'mc', severity: difficulty === 'B2' ? 'error' : 'warning',
        message: `${difficulty === 'C1' ? 'C1: ' : ''}Expected exactly ${expectedCount} "${typeName}" question(s), got ${actual}`,
        suggestion: `Adjust question types to match the distribution`,
      });
    }
  }

  // ---- Distractor pattern validation ----
  const patternCounts: Record<string, number> = {};
  fixedMC.forEach((q, i) => {
    const correctLetter = q.answer?.toUpperCase();
    if (!correctLetter) return;

    const wrongLetters = ['A', 'B', 'C', 'D'].filter(l => l !== correctLetter);

    // Check each wrong option has a distractor
    if (!q.distractors || Object.keys(q.distractors).length === 0) {
      issues.push({
        type: 'rule', section: 'mc', severity: 'warning',
        message: `Q${i + 1}: Missing distractor metadata for wrong options`,
        suggestion: 'Each wrong option must have a distractor pattern and rationale',
      });
    } else {
      for (const letter of wrongLetters) {
        const d = q.distractors[letter];
        if (!d) {
          issues.push({
            type: 'rule', section: 'mc', severity: 'warning',
            message: `Q${i + 1}: Wrong option ${letter} is missing distractor metadata`,
          });
        } else {
          if (!ALLOWED_PATTERNS.includes(d.pattern as DistractorPattern)) {
            issues.push({
              type: 'rule', section: 'mc', severity: 'warning',
              message: `Q${i + 1}: Option ${letter} has unknown distractor pattern "${d.pattern}"`,
            });
          }
          if (!d.rationale || d.rationale.trim().length === 0) {
            issues.push({
              type: 'rule', section: 'mc', severity: 'warning',
              message: `Q${i + 1}: Option ${letter} distractor is missing rationale`,
            });
          }
          patternCounts[d.pattern] = (patternCounts[d.pattern] || 0) + 1;
        }
      }

      // Check no distractor on correct answer
      if (q.distractors[correctLetter]) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'warning',
          message: `Q${i + 1}: Correct answer ${correctLetter} should not have distractor metadata`,
        });
      }
    }
  });

  // ---- Option length parity (word count, relative to the correct option) ----
  fixedMC.forEach((q, i) => {
    const violations = getOptionLengthViolations(q.options, q.answer);
    for (const violation of violations) {
      const optionLabel = `${violation.words} word${violation.words === 1 ? '' : 's'}`;
      const correctLabel = `${violation.correctWords} word${violation.correctWords === 1 ? '' : 's'}`;
      issues.push({
        type: 'rule',
        section: 'mc',
        severity: 'warning',
        message: `Q${i + 1}: Option ${violation.letter} has ${optionLabel}, but the correct option ${violation.correctLetter} has ${correctLabel} — every option must be within ${OPTION_LENGTH_TOLERANCE_WORDS} words of the correct answer`,
        suggestion: `Rewrite Option ${violation.letter} to ${Math.max(1, violation.correctWords - OPTION_LENGTH_TOLERANCE_WORDS)}-${violation.correctWords + OPTION_LENGTH_TOLERANCE_WORDS} words.`,
      });
    }
  });

  // ---- Evidence pair validation ----
  const evidenceQuestions = fixedMC.filter(q => q.type === 'Evidence Reasoning');
  if (evidenceQuestions.length !== 2) {
    // Count already validated above; this is just a structural check
  } else {
    const linked = evidenceQuestions.filter(q => q.evidencePairLink);
    if (linked.length < 2) {
      issues.push({
        type: 'rule', section: 'mc', severity: 'warning',
        message: 'Evidence Reasoning questions must form a linked pair with evidencePairLink fields',
        suggestion: 'Add evidencePairLink: { claimQuestionId, evidenceQuestionId } to both Evidence Reasoning questions',
      });
    } else {
      // Verify the link is bidirectional
      const qA = linked[0];
      const qB = linked[1];
      const linkA = qA.evidencePairLink!;
      const linkB = qB.evidencePairLink!;
      if (linkA.claimQuestionId !== qB.id || linkB.evidenceQuestionId !== qA.id) {
        // Check both orientations
        const valid =
          (linkA.claimQuestionId === qA.id && linkA.evidenceQuestionId === qB.id && linkB.claimQuestionId === qA.id && linkB.evidenceQuestionId === qB.id) ||
          (linkA.claimQuestionId === qB.id && linkA.evidenceQuestionId === qA.id && linkB.claimQuestionId === qB.id && linkB.evidenceQuestionId === qA.id);
        if (!valid) {
          issues.push({
            type: 'rule', section: 'mc', severity: 'warning',
            message: 'Evidence pair link is inconsistent — claimQuestionId and evidenceQuestionId must cross-reference correctly',
          });
        }
      }
    }
  }

  // ---- Cognitive level checks ----
  const cognitiveLevels: Record<string, number> = {};
  const ALLOWED_LEVELS = ['retrieval', 'inference', 'synthesis'];
  fixedMC.forEach((q, i) => {
    const level = q.cognitiveLevel;
    if (level) {
      if (!ALLOWED_LEVELS.includes(level)) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'warning',
          message: `Q${i + 1}: Unknown cognitiveLevel "${level}"`,
        });
      }
      cognitiveLevels[level] = (cognitiveLevels[level] || 0) + 1;
    } else {
      issues.push({
        type: 'rule', section: 'mc', severity: 'warning',
        message: `Q${i + 1}: Missing cognitiveLevel field`,
      });
    }
  });

  // Check retrieval/inference/synthesis balance
  const retrievalCount = cognitiveLevels['retrieval'] || 0;
  const inferenceCount = cognitiveLevels['inference'] || 0;
  const synthesisCount = cognitiveLevels['synthesis'] || 0;

  const maxRetrieval =
    difficulty === 'A2' ? 8 :
    difficulty === 'B1' ? 5 :
    difficulty === 'C1' ? 1 :
    difficulty === 'B2' ? 1 :
    2;
  const minInference =
    difficulty === 'A2' ? 1 :
    difficulty === 'B1' ? 3 :
    difficulty === 'C1' ? 4 :
    difficulty === 'B2' ? 5 :
    3;
  const minSynthesis =
    difficulty === 'A2' ? 0 :
    difficulty === 'B1' ? 1 :
    difficulty === 'C1' ? 5 :
    difficulty === 'B2' ? 3 :
    1;

  if (retrievalCount > maxRetrieval) {
    issues.push({
      type: 'rule', section: 'mc', severity: 'warning',
      message: `Too many retrieval-level questions (${retrievalCount}/10). Max ${maxRetrieval} allowed.`,
      suggestion: 'Convert excess retrieval questions to inference or synthesis level',
    });
  }
  if (inferenceCount < minInference) {
    issues.push({
      type: 'rule', section: 'mc', severity: 'warning',
      message: `Too few inference-level questions (${inferenceCount}/10). At least ${minInference} required.`,
      suggestion: `Ensure at least ${minInference} questions require combining information or identifying implications`,
    });
  }
  if (synthesisCount < minSynthesis) {
    issues.push({
      type: 'rule', section: 'mc', severity: 'warning',
      message: `Too few synthesis-level questions (${synthesisCount}/10). At least ${minSynthesis} required.`,
      suggestion: 'Add a question requiring transfer, evaluation, or cross-passage reasoning',
    });
  }

  if (difficulty === 'B2') {
    // Slot metadata was already aligned to B2_MC_SLOT_RULES above; only
    // substantive content requirements remain as hard errors.
    for (const question of fixedMC) {
      const slot = getB2SlotNumber(question.id);
      if (slot === null) continue;
      if (!question.skillTarget?.trim()) {
        issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `${question.id}: Missing B2 skillTarget` });
      }
      if (
        B2_REASONING_SLOTS.has(slot) &&
        (!question.evidence || question.evidence.length < 2 || !question.reasoningSteps || question.reasoningSteps.length < 2)
      ) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'error',
          message: `${question.id}: B2 inference/synthesis requires at least 2 evidence references and 2 reasoning steps`,
        });
      }
    }

    const attitude = fixedMC.find(question => getB2SlotNumber(question.id) === 8);
    if (!attitude || !/(attitude|tone|stance|viewpoint|position)/i.test(`${attitude.question} ${attitude.skillTarget || ''}`)) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: 'Q8 must explicitly test author attitude, tone, or stance' });
    }
  }

  return { issues, fixedData };
}
