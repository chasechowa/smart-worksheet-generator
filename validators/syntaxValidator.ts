import type { WorksheetData, ValidationIssue } from '../types';
import { findVerbatimMatch, describeMatch } from './verbatimMatcher';

export function validateSyntax(data: WorksheetData, articleText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const items = data.syntaxDeconstruction || [];

  if (items.length !== 2) {
    issues.push({
      type: 'rule',
      section: 'syntax',
      severity: 'error',
      message: `Expected exactly 2 syntax deconstruction items, got ${items.length}`,
    });
  }

  items.forEach((item, i) => {
    if (!item.original || item.original.trim().length === 0) {
      issues.push({
        type: 'structure',
        section: 'syntax',
        severity: 'error',
        message: `Syntax item ${i + 1}: original sentence is empty`,
      });
      return;
    }

    if (!item.answer || item.answer.trim().length === 0) {
      issues.push({
        type: 'structure',
        section: 'syntax',
        severity: 'error',
        message: `Syntax item ${i + 1}: answer is empty`,
      });
    }

    // ---- Verbatim verification (tiered) ----
    // Syntax items are full sentences; they should match exactly or near-exactly.
    const result = findVerbatimMatch(item.original, articleText);

    switch (result.status) {
      case 'exact':
        // Clean match — no issue.
        if (!result.boundaryPreserved) {
          issues.push({
            type: 'rule',
            section: 'syntax',
            severity: 'warning',
            message: `Syntax item ${i + 1}: original sentence found but embedded in longer text (confidence: ${result.confidence})`,
            suggestion: 'Extract the exact standalone sentence from the article',
          });
        }
        break;

      case 'partial':
        issues.push({
          type: 'rule',
          section: 'syntax',
          severity: 'warning',
          message: `Syntax item ${i + 1}: sentence words all appear but NOT as a contiguous phrase (${describeMatch(result)})`,
          suggestion: 'Original sentence must be copied verbatim from the article — no rewording allowed',
        });
        break;

      case 'fuzzy':
      case 'missing':
        issues.push({
          type: 'rule',
          section: 'syntax',
          severity: 'warning',
          message: `Syntax item ${i + 1}: original sentence not closely matching article text (${describeMatch(result)})`,
          suggestion: 'Sentence should be extracted verbatim from the article',
        });
        break;
    }
  });

  return issues;
}
