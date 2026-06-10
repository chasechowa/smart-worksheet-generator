/**
 * Verbatim Verification System
 *
 * Replaces simple string-inclusion checks with tiered matching:
 *   exact  — full phrase found contiguously with preserved boundaries
 *   partial — all individual words found but not contiguously
 *   fuzzy  — some words found (≥50% by word count)
 *   missing — no meaningful match
 *
 * Each result includes:
 *   - confidence score (0.0–1.0)
 *   - matched text from the article
 *   - surrounding context for human review
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerbatimStatus = 'exact' | 'partial' | 'fuzzy' | 'missing';

export interface VerbatimResult {
  status: VerbatimStatus;
  confidence: number;          // 0.0 – 1.0
  matchedText: string;         // The substring from the article that matched
  context: string;             // Surrounding text (sentence-level) around the match
  matchStart: number;          // Character index of match start in original article
  matchEnd: number;            // Character index of match end in original article
  boundaryPreserved: boolean;  // true if match sits at natural word boundaries
  details: string;             // Human-readable diagnostic
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Unicode smart quotes → ASCII, em-dashes → hyphens, etc. */
const UNICODE_REPLACEMENTS: [RegExp, string][] = [
  [/‘|’|‚|‛|′|‵/g, "'"],  // single quotes
  [/“|”|„|‟|″|‶/g, '"'],  // double quotes
  [/–|—|―/g, '-'],                         // dashes
  [/ | | | | | | | | | | | |​| | |　|﻿/g, ' '], // special spaces
  [/…/g, '...'],                                     // ellipsis
];

/**
 * Normalize text for comparison.
 * - NFKD unicode normalization
 * - Replace smart quotes, special dashes, non-breaking spaces
 * - Lowercase
 * - Collapse whitespace
 * - Strip leading/trailing whitespace
 */
export function normalizeText(text: string): string {
  let out = text.normalize('NFKD');

  for (const [pattern, replacement] of UNICODE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  out = out.toLowerCase();
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Normalize but retain more structure for word-boundary checks.
 * Like normalizeText but keeps sentence-terminal punctuation
 * so we can detect phrase boundaries.
 */
function normalizeForBoundary(text: string): string {
  let out = text.normalize('NFKD');

  for (const [pattern, replacement] of UNICODE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  out = out.toLowerCase();
  out = out.replace(/[^\w\s.!?;:,-]/g, ' ');  // keep sentence punctuation
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// ---------------------------------------------------------------------------
// Word-boundary helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a position in the text sits at a "word boundary" —
 * preceded/followed by whitespace, punctuation, or text edge.
 */
function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  if (index >= text.length) return true;
  const ch = text[index];
  return /\s|[.!?;:,'"\-()\[\]{}]/.test(ch) || false;
}

function isAlphanumeric(ch: string): boolean {
  return /[a-zA-Z0-9]/.test(ch);
}

// ---------------------------------------------------------------------------
// Sentence extraction (for context)
// ---------------------------------------------------------------------------

/** Extract a ~sentence-length window around a given position. */
function extractContext(article: string, start: number, end: number, maxLen = 300): string {
  // Expand to sentence boundaries
  const sentenceBreaks = /[.!?]\s+/g;
  let ctxStart = start;
  let ctxEnd = end;

  // Walk backwards to find previous sentence break
  let match: RegExpExecArray | null;
  const regex = new RegExp('[.!?]\\s+', 'g');
  let lastBreak = 0;
  while ((match = regex.exec(article)) !== null) {
    if (match.index < start) {
      lastBreak = match.index + match[0].length;
    } else {
      break;
    }
  }
  if (lastBreak > 0) ctxStart = lastBreak;

  // Walk forward to find next sentence break
  regex.lastIndex = end;
  const nextBreak = regex.exec(article);
  if (nextBreak) {
    ctxEnd = nextBreak.index + nextBreak[0].length;
  } else {
    ctxEnd = Math.min(article.length, end + maxLen);
  }

  let context = article.slice(ctxStart, ctxEnd).trim();
  if (context.length > maxLen) {
    context = '…' + context.slice(-(maxLen - 1));
  }
  return context;
}

// ---------------------------------------------------------------------------
// Word-level analysis
// ---------------------------------------------------------------------------

interface WordAnalysis {
  answerWords: string[];
  foundWords: string[];      // words that appear in article
  missingWords: string[];    // words that don't appear
  wordRatio: number;         // foundWords.length / answerWords.length
  allFound: boolean;         // every answer word appears somewhere in article
}

/** Strip leading/trailing punctuation for word-level comparison. */
function stripWordPunctuation(w: string): string {
  return w.replace(/^[^\w]+/, '').replace(/[^\w]+$/, '');
}

function analyzeWords(answer: string, article: string): WordAnalysis {
  const answerWords = answer.split(/\s+/).filter(w => w.length > 0);
  // Strip punctuation from article words for word-level matching
  const articleWords = new Set(
    article.split(/\s+/).map(stripWordPunctuation).filter(w => w.length > 0)
  );

  const foundWords: string[] = [];
  const missingWords: string[] = [];

  for (const w of answerWords) {
    const cleaned = stripWordPunctuation(w);
    if (articleWords.has(cleaned)) {
      foundWords.push(w);
    } else {
      missingWords.push(w);
    }
  }

  return {
    answerWords,
    foundWords,
    missingWords,
    wordRatio: answerWords.length > 0 ? foundWords.length / answerWords.length : 0,
    allFound: missingWords.length === 0 && answerWords.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Core matching function
// ---------------------------------------------------------------------------

/**
 * Find a verbatim match for `answer` within `article`.
 *
 * Matching tiers (in priority order):
 *
 * 1. **exact**   — the normalized answer appears as a contiguous substring.
 *    confidence = 1.0 if word boundaries preserved, else 0.95.
 *
 * 2. **partial** — all individual words appear, but not contiguously.
 *    confidence = 0.7.
 *
 * 3. **fuzzy**   — ≥50% of words appear (by count).
 *    confidence = wordRatio × 0.6 (range 0.3–0.6).
 *
 * 4. **missing** — <50% of words found, or answer is empty.
 *    confidence = wordRatio × 0.3 (range 0.0–0.3).
 */
export function findVerbatimMatch(answer: string, article: string): VerbatimResult {
  // --- Guard: empty answer ---
  if (!answer || answer.trim().length === 0) {
    return {
      status: 'missing',
      confidence: 0,
      matchedText: '',
      context: '',
      matchStart: -1,
      matchEnd: -1,
      boundaryPreserved: false,
      details: 'Answer is empty',
    };
  }

  const normAnswer = normalizeText(answer);
  const normArticle = normalizeText(article);
  const boundaryArticle = normalizeForBoundary(article);

  // --- Tier 1: contiguous substring match ---
  const matchIndex = normArticle.indexOf(normAnswer);

  if (matchIndex >= 0) {
    // Found contiguous substring. Now check word boundaries in the
    // boundary-normalized version (which retains sentence punctuation).
    const boundaryAnswer = normalizeForBoundary(answer);
    const boundaryIdx = boundaryArticle.indexOf(boundaryAnswer);

    let boundaryPreserved = false;
    if (boundaryIdx >= 0) {
      const beforeOk = isWordBoundary(boundaryArticle, boundaryIdx - 1);
      const afterOk = isWordBoundary(boundaryArticle, boundaryIdx + boundaryAnswer.length);
      boundaryPreserved = beforeOk && afterOk;
    }

    // Map back to original article for matchedText / context
    const origMatchText = article.slice(matchIndex, matchIndex + normAnswer.length);
    const context = extractContext(article, matchIndex, matchIndex + normAnswer.length);

    if (boundaryPreserved) {
      return {
        status: 'exact',
        confidence: 1.0,
        matchedText: origMatchText,
        context,
        matchStart: matchIndex,
        matchEnd: matchIndex + normAnswer.length,
        boundaryPreserved: true,
        details: `Exact phrase found with preserved word boundaries: "${origMatchText}"`,
      };
    }

    return {
      status: 'exact',
      confidence: 0.95,
      matchedText: origMatchText,
      context,
      matchStart: matchIndex,
      matchEnd: matchIndex + normAnswer.length,
      boundaryPreserved: false,
      details: `Phrase found as contiguous substring but embedded in longer text: "${origMatchText}"`,
    };
  }

  // --- Tier 2-4: word-level analysis ---
  const wordAnalysis = analyzeWords(normAnswer, normArticle);

  if (wordAnalysis.allFound) {
    // All words are in the article, just not contiguous — build context from first match
    const firstWord = wordAnalysis.answerWords[0];
    const firstIdx = normArticle.indexOf(firstWord);
    const context = firstIdx >= 0
      ? extractContext(article, firstIdx, firstIdx + firstWord.length)
      : '';

    return {
      status: 'partial',
      confidence: 0.7,
      matchedText: wordAnalysis.foundWords.join(' '),
      context,
      matchStart: firstIdx,
      matchEnd: firstIdx >= 0 ? firstIdx + firstWord.length : -1,
      boundaryPreserved: false,
      details: `All ${wordAnalysis.answerWords.length} word(s) found but not contiguous. Missing words: none`,
    };
  }

  if (wordAnalysis.wordRatio >= 0.5) {
    return {
      status: 'fuzzy',
      confidence: Math.round(wordAnalysis.wordRatio * 0.6 * 100) / 100,
      matchedText: wordAnalysis.foundWords.join(' '),
      context: '',
      matchStart: -1,
      matchEnd: -1,
      boundaryPreserved: false,
      details: `${wordAnalysis.foundWords.length}/${wordAnalysis.answerWords.length} words found. Missing: ${wordAnalysis.missingWords.join(', ')}`,
    };
  }

  return {
    status: 'missing',
    confidence: Math.round(wordAnalysis.wordRatio * 0.3 * 100) / 100,
    matchedText: wordAnalysis.foundWords.join(' '),
    context: '',
    matchStart: -1,
    matchEnd: -1,
    boundaryPreserved: false,
    details: `Only ${wordAnalysis.foundWords.length}/${wordAnalysis.answerWords.length} words found. Missing: ${wordAnalysis.missingWords.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Convenience helpers for validators
// ---------------------------------------------------------------------------

/**
 * Returns true if the answer appears as an exact contiguous phrase
 * with preserved word boundaries in the article.
 */
export function isExactVerbatimMatch(answer: string, article: string): boolean {
  const result = findVerbatimMatch(answer, article);
  return result.status === 'exact' && result.boundaryPreserved;
}

/**
 * Returns true if the answer appears as a contiguous substring
 * (boundary check optional — pass `true` to require boundaries).
 */
export function isContiguousMatch(answer: string, article: string, requireBoundaries = false): boolean {
  const result = findVerbatimMatch(answer, article);
  if (result.status !== 'exact') return false;
  if (requireBoundaries && !result.boundaryPreserved) return false;
  return true;
}

/**
 * Returns a human-readable one-line summary of the match quality.
 */
export function describeMatch(result: VerbatimResult): string {
  const pct = Math.round(result.confidence * 100);
  switch (result.status) {
    case 'exact':
      return result.boundaryPreserved
        ? `✓ Exact (${pct}%) — boundaries preserved`
        : `✓ Contiguous (${pct}%) — embedded in longer text`;
    case 'partial':
      return `~ Partial (${pct}%) — all words present, not contiguous`;
    case 'fuzzy':
      return `? Fuzzy (${pct}%) — ${result.details}`;
    case 'missing':
      return `✗ Missing (${pct}%) — ${result.details}`;
  }
}
