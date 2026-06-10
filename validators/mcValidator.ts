import type { WorksheetData, ValidationIssue, MCQuestion, MCQuestionType, DistractorPattern } from '../types';

const EXPECTED_MC_COUNT = 10;

// Current type distribution (exact counts)
const EXPECTED_TYPE_COUNTS: Record<MCQuestionType, number> = {
  'Main Idea': 1,
  'Literal Comprehension': 2,
  'Inference': 3,
  'Evidence Reasoning': 2,
  'Vocabulary in Context': 1,
  'Structure / Function / Synthesis': 1,
};

const ALLOWED_TYPES: MCQuestionType[] = Object.keys(EXPECTED_TYPE_COUNTS) as MCQuestionType[];

const ALLOWED_PATTERNS: DistractorPattern[] = [
  'Too Broad', 'Too Narrow', 'Partially True',
  'Wrong Scope', 'Unsupported Inference', 'Reversed Logic',
];

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
  return text.replace(/^[A-Da-d][.)\]]\s*/, '').replace(/^\d+[.)\]]\s*/, '').trim();
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

  // Backward compat: answer is option text — try to find matching option
  const cleanAnswer = stripPrefix(q.answer).toLowerCase();
  if (!cleanAnswer) return null;

  const idx = q.options.findIndex(opt => {
    const cleanOpt = stripPrefix(opt).toLowerCase();
    return cleanOpt === cleanAnswer ||
           opt.toLowerCase().trim() === q.answer?.toLowerCase().trim();
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
  return { ...q, options: rotated, answer: targetLetter };
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

export function validateMC(data: WorksheetData): { issues: ValidationIssue[]; fixedData: WorksheetData } {
  const issues: ValidationIssue[] = [];
  const mc = data.multipleChoice || [];

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
    const fixedQ: MCQuestion = {
      ...q,
      options: q.options.map(opt => stripPrefix(opt)),
    };

    if (q.options.length !== 4) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `Q${i + 1}: Expected 4 options, got ${q.options.length}` });
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

    return fixedQ;
  });

  // Step 2: auto-fix answer distribution (rotate options)
  fixedMC = fixAnswerDistribution(fixedMC);

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
  for (const [typeName, expectedCount] of Object.entries(EXPECTED_TYPE_COUNTS)) {
    const actual = typeCounts[typeName] || 0;
    if (actual !== expectedCount) {
      issues.push({
        type: 'rule', section: 'mc', severity: 'warning',
        message: `Expected exactly ${expectedCount} "${typeName}" question(s), got ${actual}`,
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

  // Warn if any distractor pattern is overused (more than 33% of all distractors)
  const totalDistractors = Object.values(patternCounts).reduce((a, b) => a + b, 0);
  if (totalDistractors > 0) {
    for (const [pattern, count] of Object.entries(patternCounts)) {
      const ratio = count / totalDistractors;
      if (ratio > 0.33) {
        issues.push({
          type: 'rule', section: 'mc', severity: 'warning',
          message: `Distractor pattern "${pattern}" is overused (${count}/${totalDistractors} = ${Math.round(ratio * 100)}%)`,
          suggestion: 'Distribute distractor patterns more evenly',
        });
      }
    }
  }

  // ---- Option length balance ----
  fixedMC.forEach((q, i) => {
    const lengths = q.options.map(o => o.length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    if (maxLen > minLen * 1.3) {
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

  if (retrievalCount > 2) {
    issues.push({
      type: 'rule', section: 'mc', severity: 'warning',
      message: `Too many retrieval-level questions (${retrievalCount}/10). Max 2 allowed.`,
      suggestion: 'Convert excess retrieval questions to inference or synthesis level',
    });
  }
  if (inferenceCount < 3) {
    issues.push({
      type: 'rule', section: 'mc', severity: 'warning',
      message: `Too few inference-level questions (${inferenceCount}/10). At least 3 required.`,
      suggestion: 'Ensure at least 3 questions require combining information or identifying implications',
    });
  }
  if (synthesisCount < 1) {
    issues.push({
      type: 'rule', section: 'mc', severity: 'warning',
      message: `No synthesis-level questions. At least 1 required.`,
      suggestion: 'Add a question requiring transfer, evaluation, or cross-passage reasoning',
    });
  }

  return { issues, fixedData };
}
