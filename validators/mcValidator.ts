import type { WorksheetData, ValidationIssue, MCQuestion, MCQuestionType, DistractorPattern, Difficulty } from '../types';

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

function stripPrefix(text: string): string {
  return String(text ?? '').replace(/^[A-Da-d][.)\]]\s*/, '').replace(/^\d+[.)\]]\s*/, '').trim();
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

    // Auto-fix unknown type: try migration map first, then default
    if (!ALLOWED_TYPES.includes(q.type as any)) {
      const migrated = TYPE_MIGRATION[q.type];
      fixedQ.type = migrated || 'Literal Comprehension';
      if (migrated) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'warning',
          message: `Q${i + 1}: Type "${q.type}" auto-migrated to "${migrated}"`,
        });
      }
    }

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

  // ---- Option length balance ----
  fixedMC.forEach((q, i) => {
    const lengths = q.options.map(o => o.length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    if (maxLen - minLen >= 30 && maxLen > minLen * 1.6) {
      issues.push({ type: 'rule', section: 'mc', severity: 'warning', message: `Q${i + 1}: Option lengths vary significantly (${minLen}-${maxLen} chars)` });
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
    const expectedSlots: Record<string, { type: MCQuestionType; level: string; scope: string }> = {
      q1: { type: 'Main Idea', level: 'synthesis', scope: 'whole-text' },
      q2: { type: 'Literal Comprehension', level: 'retrieval', scope: 'single-paragraph' },
      q3: { type: 'Inference', level: 'inference', scope: 'single-paragraph' },
      q4: { type: 'Inference', level: 'inference', scope: 'cross-paragraph' },
      q5: { type: 'Inference', level: 'synthesis', scope: 'whole-text' },
      q6: { type: 'Evidence Reasoning', level: 'inference', scope: 'cross-paragraph' },
      q7: { type: 'Evidence Reasoning', level: 'inference', scope: 'cross-paragraph' },
      q8: { type: 'Structure / Function / Synthesis', level: 'synthesis', scope: 'whole-text' },
      q9: { type: 'Vocabulary in Context', level: 'inference', scope: 'single-paragraph' },
      q10: { type: 'Structure / Function / Synthesis', level: 'synthesis', scope: 'whole-text' },
    };
    const reasoningIds = new Set(['q1', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q10']);

    for (const question of fixedMC) {
      const expected = expectedSlots[question.id];
      if (!expected) continue;
      if (question.type !== expected.type || question.cognitiveLevel !== expected.level || question.scope !== expected.scope) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'error',
          message: `${question.id}: Does not match the fixed B2 skill slot`,
          suggestion: `Expected ${expected.type} / ${expected.level} / ${expected.scope}`,
        });
      }
      if (!question.skillTarget?.trim()) {
        issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `${question.id}: Missing B2 skillTarget` });
      }
      if (reasoningIds.has(question.id) && (!question.evidence || question.evidence.length < 2 || !question.reasoningSteps || question.reasoningSteps.length < 2)) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'error',
          message: `${question.id}: B2 inference/synthesis requires at least 2 evidence references and 2 reasoning steps`,
        });
      }
    }

    const attitude = fixedMC.find(question => question.id === 'q8');
    if (!attitude || !/(attitude|tone|stance|viewpoint|position)/i.test(`${attitude.question} ${attitude.skillTarget || ''}`)) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: 'Q8 must explicitly test author attitude, tone, or stance' });
    }
  }

  return { issues, fixedData };
}
