import type { WorksheetData, ValidationIssue } from '../types';

export function validateSummary(data: WorksheetData, articleText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { summary, keys } = data;

  if (!summary || !summary.paragraph) {
    issues.push({ type: 'structure', section: 'summary', severity: 'error', message: 'Summary paragraph is missing' });
    return issues;
  }

  const blankMatches = summary.paragraph.match(/\[BLANK\]/g) || [];
  const blankCount = blankMatches.length;

  if (blankCount === 0) {
    issues.push({ type: 'structure', section: 'summary', severity: 'error', message: 'Summary paragraph contains no [BLANK] tokens' });
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
    const articleLower = articleText.toLowerCase();
    const blankLower = currentBlank.toLowerCase().replace(/[^\w\s]/g, '');
    if (blankLower && !articleLower.includes(blankLower)) {
      // Still emit as warning (can't auto-fix content)
      issues.push({
        type: 'rule',
        section: 'summary',
        severity: 'warning',
        message: `Blank ${i + 1} answer "${blank}" not found in original article`,
        suggestion: 'Answer should be extractable from the article text',
      });
    }
  });

  return issues;
}
