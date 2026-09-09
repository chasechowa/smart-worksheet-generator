import type { WorksheetData, ValidationIssue } from '../types';
import { findVerbatimMatch, describeMatch, type VerbatimResult } from './verbatimMatcher';

const BLANK_TOKEN_RE = /\[BLANK\d*\]/gi;

export function validateSummary(data: WorksheetData, articleText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { summary, keys } = data;

  if (!summary || !summary.paragraph) {
    issues.push({ type: 'structure', section: 'summary', severity: 'error', message: 'Summary paragraph is missing' });
    return issues;
  }

  const normalizedParagraph = summary.paragraph.replace(BLANK_TOKEN_RE, '[BLANK]');
  if (normalizedParagraph !== summary.paragraph) {
    summary.paragraph = normalizedParagraph;
  }

  const blankMatches = summary.paragraph.match(/\[BLANK\]/g) || [];
  const blankCount = blankMatches.length;

  if (blankCount === 0) {
    issues.push({ type: 'structure', section: 'summary', severity: 'error', message: 'Summary paragraph contains no [BLANK] tokens' });
  } else if (blankCount !== 5) {
    issues.push({ type: 'rule', section: 'summary', severity: 'error', message: `Expected exactly 5 summary blanks, got ${blankCount}` });
  }

  // Auto-fix blanks array to match [BLANK] count
  if (summary.blanks && summary.blanks.length !== blankCount) {
    issues.push({
      type: 'rule',
      section: 'summary',
      severity: 'error',
      message: `Summary blanks array length (${summary.blanks.length}) does not match [BLANK] count in paragraph (${blankCount})`,
    });
  }

  if (keys?.summary && keys.summary.length !== blankCount) {
    issues.push({
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: `Summary keys count (${keys.summary.length}) does not match [BLANK] count (${blankCount})`,
    });
  }

  const blanksToCheck = summary.blanks || [];
  blanksToCheck.forEach((blank, i) => {
    const wordCount = blank.trim().split(/\s+/).length;
    if (wordCount > 3) {
      // Auto-fix: truncate to 3 words
      const truncated = blank.trim().split(/\s+/).slice(0, 3).join(' ');
      data.summary!.blanks![i] = truncated;
      if (data.keys?.summary && data.keys.summary[i]) {
        data.keys.summary[i] = truncated;
      }
    }

    // Use potentially truncated value
    const currentBlank = data.summary!.blanks![i];
    if (!currentBlank || currentBlank.trim().length === 0) return;

    // ---- Verbatim verification (tiered) ----
    const result = findVerbatimMatch(currentBlank, articleText);

    switch (result.status) {
      case 'exact':
        // Clean — no issue. If boundaries not preserved, note but don't warn.
        if (!result.boundaryPreserved) {
          issues.push({
            type: 'rule',
            section: 'summary',
            severity: 'warning',
            message: `Blank ${i + 1} "${currentBlank}" found as substring but embedded in longer text: "${result.matchedText}"`,
            suggestion: `Consider using the exact phrase: "${result.matchedText}" from article context`,
          });
        }
        break;

      case 'partial':
        issues.push({
          type: 'rule',
          section: 'summary',
          severity: 'warning',
          message: `Blank ${i + 1} "${currentBlank}": all words found individually but NOT as a contiguous phrase (${describeMatch(result)})`,
          suggestion: 'Answer words should appear together as an exact phrase in the article',
        });
        break;

      case 'fuzzy':
        issues.push({
          type: 'rule',
          section: 'summary',
          severity: 'warning',
          message: `Blank ${i + 1} "${currentBlank}": only some words found in article (${describeMatch(result)})`,
          suggestion: 'Answer should be extractable from the article text verbatim',
        });
        break;

      case 'missing':
        issues.push({
          type: 'rule',
          section: 'summary',
          severity: 'warning',
          message: `Blank ${i + 1} "${currentBlank}" not found in original article (${describeMatch(result)})`,
          suggestion: 'Answer should be extractable from the article text',
        });
        break;
    }
  });

  return issues;
}
