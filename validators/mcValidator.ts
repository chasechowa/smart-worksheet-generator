import type { WorksheetData, ValidationIssue, MCQuestion } from '../types';

const EXPECTED_MC_COUNT = 10;
const ALLOWED_TYPES = ['Main Idea', 'Vocabulary in Context', 'Detail & Inference', 'Function/Tone', 'Paraphrase', 'Finding Evidence'];

function stripPrefix(text: string): string {
  return text.replace(/^[A-Da-d][.)\]]\s*/, '').replace(/^\d+[.)\]]\s*/, '').trim();
}

function optionToLetter(options: string[], answer: string): string | null {
  const idx = options.findIndex(opt => opt === answer || stripPrefix(opt) === stripPrefix(answer));
  if (idx >= 0) return String.fromCharCode(65 + idx);
  return null;
}

/** Get the answer letter regardless of whether answer is already a letter or option text. */
function answerToLetter(q: MCQuestion): string | null {
  if (/^[A-D]$/i.test(q.answer)) return q.answer.toUpperCase();
  return optionToLetter(q.options, q.answer);
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
    const letter = answerToLetter(q);
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

    // Validate answer — answerToLetter handles both letter ("A") and text formats
    const answerLetter = answerToLetter(q);
    if (!answerLetter) {
      issues.push({ type: 'rule', section: 'mc', severity: 'error', message: `Q${i + 1}: Answer "${q.answer}" does not match any option` });
      fixedQ.answer = q.answer;
    } else {
      fixedQ.answer = answerLetter;
    }

    // Auto-fix unknown type
    if (!ALLOWED_TYPES.includes(q.type as any)) {
      fixedQ.type = 'Detail & Inference';
    }

    // Auto-fill missing explanation
    if (!q.explanation || q.explanation.trim().length === 0) {
      fixedQ.explanation = 'This is the correct answer based on the passage.';
    }

    return fixedQ;
  });

  // Step 2: auto-fix answer distribution (rotate options)
  fixedMC = fixAnswerDistribution(fixedMC);

  // Rebuild keys after rotation
  const newKeys: Record<string, string> = {};
  fixedMC.forEach((q) => {
    const letter = answerToLetter(q);
    if (letter) newKeys[q.id] = letter;
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

    const letter = answerToLetter(q);
    if (letter) distAfter[letter]++;
  });

  // Type distribution issues (refinement can fix these)
  const findingEvidenceCount = typeCounts['Finding Evidence'] || 0;
  if (findingEvidenceCount !== 2) {
    issues.push({ type: 'rule', section: 'mc', severity: 'warning', message: `Expected exactly 2 "Finding Evidence" questions, got ${findingEvidenceCount}`, suggestion: 'Adjust question types: exactly 2 Evidence, max 1 Vocab, rest Main Idea/Detail/Function' });
  }

  const vocabCount = typeCounts['Vocabulary in Context'] || 0;
  if (vocabCount > 1) {
    issues.push({ type: 'rule', section: 'mc', severity: 'warning', message: `Expected at most 1 "Vocabulary in Context" question, got ${vocabCount}`, suggestion: 'Keep at most 1 Vocab question, convert extras to Detail & Inference' });
  }

  // Option length balance — cosmetic only
  fixedMC.forEach((q, i) => {
    const lengths = q.options.map(o => o.length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    if (maxLen > minLen * 1.3) {
      issues.push({ type: 'rule', section: 'mc', severity: 'warning', message: `Q${i + 1}: Option lengths vary significantly (${minLen}-${maxLen} chars)` });
    }
  });

  return { issues, fixedData };
}
