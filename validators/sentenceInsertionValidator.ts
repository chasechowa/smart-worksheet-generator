import type { WorksheetData, ValidationIssue, Difficulty } from '../types';
import { findVerbatimMatch, describeMatch } from './verbatimMatcher';

/** Two items per worksheet, mirroring the syntax section's fixed pair. */
export const EXPECTED_INSERTION_COUNT = 2;

const MARKER_RE = /\[([1-4])\]/g;

/** Expected word-count band for the extra sentence, per level. */
const SENTENCE_WORD_BANDS: Record<Difficulty, [number, number]> = {
  A2: [5, 16],
  B1: [8, 20],
  B2: [10, 25],
  C1: [12, 30],
};

/** Fold full-width brackets and inner spacing into the canonical `[n]` form. */
export function normalizeInsertionMarkers(paragraph: string): string {
  return String(paragraph ?? '')
    .replace(/[［【]/g, '[')
    .replace(/[］】]/g, ']')
    .replace(/\[\s*([1-4])\s*\]/g, '[$1]');
}

/** Marker labels in document order. */
export function countInsertionMarkers(paragraph: string): number[] {
  const text = normalizeInsertionMarkers(paragraph);
  const labels: number[] = [];
  const re = new RegExp(MARKER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) labels.push(Number(match[1]));
  return labels;
}

/** Split a marker-bearing paragraph into text chunks and marker positions, for rendering. */
export function splitInsertionParagraph(paragraph: string): Array<{ text: string; marker: number | null }> {
  const text = normalizeInsertionMarkers(paragraph);
  const chunks: Array<{ text: string; marker: number | null }> = [];
  const re = new RegExp(MARKER_RE.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) chunks.push({ text: text.slice(last, match.index), marker: null });
    chunks.push({ text: '', marker: Number(match[1]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) chunks.push({ text: text.slice(last), marker: null });
  return chunks;
}

/**
 * Coerce a model-supplied answer into a position 1-4. Accepts 3, "3", "[3]",
 * "position 3", and a letter A-D. Returns null when it cannot be interpreted.
 */
export function normalizeInsertionAnswer(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 4 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let match = text.match(/^\[?\s*([1-4])\s*\]?$/);
  if (match) return Number(match[1]);
  match = text.match(/^(?:position|pos|place|marker|blank|option)?\s*\[?\s*([1-4])\s*\]?$/i);
  if (match) return Number(match[1]);
  match = text.match(/^([A-Da-d])$/);
  if (match) return match[1].toUpperCase().charCodeAt(0) - 64;
  return null;
}

export function validateSentenceInsertion(
  data: WorksheetData,
  articleText: string,
  difficulty?: Difficulty,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const items = data.sentenceInsertion;
  // `undefined` means the section was never requested — stay silent.
  if (!Array.isArray(items)) return issues;

  if (items.length !== EXPECTED_INSERTION_COUNT) {
    issues.push({
      type: 'structure',
      section: 'insertion',
      severity: 'error',
      message: `Expected exactly ${EXPECTED_INSERTION_COUNT} sentence insertion items, got ${items.length}`,
    });
  }

  const seenParagraphs = new Set<string>();

  items.forEach((item, index) => {
    const label = `Item ${index + 1}`;
    const sentence = (item.sentence || '').trim();

    // --- sentence ---
    if (!sentence) {
      issues.push({ type: 'structure', section: 'insertion', severity: 'error', message: `${label}: sentence is empty` });
    } else {
      const band = difficulty ? SENTENCE_WORD_BANDS[difficulty] : undefined;
      if (band) {
        const wordCount = sentence.split(/\s+/).filter(Boolean).length;
        if (wordCount < band[0] || wordCount > band[1]) {
          issues.push({
            type: 'rule',
            section: 'insertion',
            severity: 'warning',
            message: `${label}: sentence is ${wordCount} words (expected ${band[0]}-${band[1]} for ${difficulty})`,
          });
        }
      }
      const sentenceMatch = findVerbatimMatch(sentence, articleText);
      if (sentenceMatch.status === 'exact') {
        issues.push({
          type: 'rule',
          section: 'insertion',
          severity: 'error',
          message: `${label}: the extra sentence already appears in the article`,
          suggestion: 'Write a new sentence that is not present in the article.',
        });
      } else if (sentenceMatch.status === 'partial') {
        issues.push({
          type: 'rule',
          section: 'insertion',
          severity: 'warning',
          message: `${label}: the extra sentence is assembled from article wording (${describeMatch(sentenceMatch)})`,
        });
      }
    }

    // --- paragraph ---
    const paragraphRaw = item.paragraph || '';
    if (!paragraphRaw.trim()) {
      issues.push({ type: 'structure', section: 'insertion', severity: 'error', message: `${label}: paragraph is empty` });
      return;
    }

    const normalized = normalizeInsertionMarkers(paragraphRaw);
    if (normalized !== paragraphRaw) item.paragraph = normalized;

    const labels = countInsertionMarkers(normalized);
    if (labels.length !== 4) {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'error',
        message: `${label}: expected 4 position markers, got ${labels.length}`,
      });
      return;
    }
    if (new Set(labels).size !== 4) {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'error',
        message: `${label}: position markers must be [1][2][3][4], each appearing once`,
      });
      return;
    }

    // Markers complete but out of order -> renumber in document order and remap the answer.
    const ascending = labels.every((value, i) => value === i + 1);
    if (!ascending) {
      const rank = new Map<number, number>();
      labels.forEach((value, i) => { if (!rank.has(value)) rank.set(value, i + 1); });
      let counter = 0;
      item.paragraph = item.paragraph.replace(/\[[1-4]\]/g, () => `[${++counter}]`);
      const remapped = typeof item.answer === 'number' ? rank.get(item.answer) : undefined;
      if (typeof remapped === 'number') item.answer = remapped;
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'warning',
        message: `${label}: markers were out of order; renumbered to [1][2][3][4]${typeof remapped === 'number' ? ` (answer remapped to ${remapped})` : ''}`,
      });
    }

    // A marker wedged inside a word would corrupt the paragraph once stripped.
    {
      const re = /\[[1-4]\]/g;
      let match: RegExpExecArray | null;
      let out = '';
      let cursor = 0;
      let fixed = false;
      while ((match = re.exec(item.paragraph)) !== null) {
        const before = item.paragraph[match.index - 1];
        const after = item.paragraph[match.index + match[0].length];
        const insideWord = Boolean(before && /[\w'-]/.test(before) && after && /[\w'-]/.test(after));
        if (insideWord) fixed = true;
        out += item.paragraph.slice(cursor, match.index) + (insideWord ? ' ' : '') + match[0];
        cursor = match.index + match[0].length;
      }
      out += item.paragraph.slice(cursor);
      if (fixed) {
        item.paragraph = out;
        issues.push({
          type: 'rule',
          section: 'insertion',
          severity: 'warning',
          message: `${label}: a marker was inserted inside a word; added spacing`,
        });
      }
    }

    // Paragraph must be verbatim from the article once markers are removed.
    const withoutMarkers = item.paragraph.replace(/\[[1-4]\]/g, '');
    const withSpaces = item.paragraph.replace(/\[[1-4]\]/g, ' ');
    const direct = findVerbatimMatch(withoutMarkers, articleText);
    const spaced = findVerbatimMatch(withSpaces, articleText);
    const best = direct.confidence >= spaced.confidence ? direct : spaced;
    if (best.status === 'exact') {
      if (!best.boundaryPreserved) {
        issues.push({
          type: 'rule',
          section: 'insertion',
          severity: 'warning',
          message: `${label}: paragraph matched but is embedded in longer article text`,
          suggestion: 'Start and end the paragraph at a full paragraph boundary.',
        });
      }
    } else {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'error',
        message: `${label}: paragraph is not verbatim from the article (${describeMatch(best)})`,
        suggestion: 'Copy the paragraph exactly from the article, then insert the four markers.',
      });
    }

    // Answer must be a position 1-4.
    const normalizedAnswer = normalizeInsertionAnswer(item.answer);
    if (normalizedAnswer === null) {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'error',
        message: `${label}: answer "${String(item.answer)}" is not a position 1-4`,
      });
    } else if (normalizedAnswer !== item.answer) {
      item.answer = normalizedAnswer;
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'warning',
        message: `${label}: answer coerced to position ${normalizedAnswer}`,
      });
    }

    // A sentence that opens with a bare back-reference or a conclusion marker is
    // only coherent when an antecedent/evidence sentence precedes it. Position
    // [1] follows the paragraph's opening sentence and rarely supplies either.
    if (normalizedAnswer === 1 && /^(such|this|these|that|it|they)\b/i.test(sentence)) {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'warning',
        message: `${label}: back-reference at [1] has no antecedent inside the paragraph`,
        suggestion: 'Name the referent explicitly (e.g. "Shared laughter therefore...") or move the sentence after its anchor.',
      });
    }
    if (normalizedAnswer !== 4 && /\b(therefore|thus|consequently|hence)\b/i.test(sentence)) {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'warning',
        message: `${label}: conclusion marker at [${normalizedAnswer}] — a sentence with therefore/thus usually summarizes the evidence and belongs at [4]`,
        suggestion: 'Move the sentence to [4] or rewrite it so it does not conclude the paragraph.',
      });
    }

    // Paragraph reuse across items.
    const paragraphKey = item.paragraph.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seenParagraphs.has(paragraphKey)) {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'warning',
        message: `${label}: reuses the paragraph of another item`,
      });
    } else {
      seenParagraphs.add(paragraphKey);
    }

    // A back-referencing sentence cannot open the paragraph.
    const firstMarkerIndex = item.paragraph.search(/\[[1-4]\]/);
    if (firstMarkerIndex === 0 && /^(however|therefore|thus|moreover|in addition|this|these|such|it)\b/i.test(sentence)) {
      issues.push({
        type: 'rule',
        section: 'insertion',
        severity: 'warning',
        message: `${label}: a sentence opening with a back-reference cannot start the paragraph`,
      });
    }
  });

  return issues;
}
