import type { WorksheetData, ValidationIssue } from '../types';
import { findVerbatimMatch, describeMatch } from './verbatimMatcher';

const DEFAULT_CONJUNCTIONS = ['however', 'therefore', 'moreover', 'consequently'];

export function validateWriting(data: WorksheetData, articleText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ww = data.writingWorkshop;

  if (!ww) {
    issues.push({ type: 'structure', section: 'writing', severity: 'error', message: 'Writing Workshop section is missing' });
    return issues;
  }

  // Expansion
  const expansions = ww.expansion || [];
  if (expansions.length !== 4) {
    issues.push({ type: 'rule', section: 'writing', severity: 'error', message: `Expected exactly 4 sentence expansion items, got ${expansions.length}` });
  }
  expansions.forEach((ex, i) => {
    if (!ex.fact || ex.fact.trim().length === 0) {
      issues.push({ type: 'structure', section: 'writing', severity: 'error', message: `Expansion ${i + 1}: fact is empty` });
    }
    // Auto-fix missing conjunctions
    if (!ex.conjunctions || ex.conjunctions.length === 0) {
      ex.conjunctions = DEFAULT_CONJUNCTIONS.slice(0, 2);
    }
  });

  // Keywords — verbatim verification
  const keywords = ww.keywords || [];
  if (keywords.length !== 5) {
    issues.push({ type: 'rule', section: 'writing', severity: 'error', message: `Expected exactly 5 keywords, got ${keywords.length}` });
  }
  keywords.forEach((kw, i) => {
    if (!kw || kw.trim().length === 0) {
      issues.push({ type: 'structure', section: 'writing', severity: 'error', message: `Keyword ${i + 1} is empty` });
      return;
    }

    const result = findVerbatimMatch(kw, articleText);

    switch (result.status) {
      case 'exact':
        // Clean match — no issue. Embedded match is acceptable for keywords.
        break;

      case 'partial':
        issues.push({
          type: 'rule',
          section: 'writing',
          severity: 'warning',
          message: `Keyword "${kw}" words all found individually but NOT as a contiguous phrase (${describeMatch(result)})`,
          suggestion: 'Keyword should appear as an exact phrase in the article',
        });
        break;

      case 'fuzzy':
        issues.push({
          type: 'rule',
          section: 'writing',
          severity: 'warning',
          message: `Keyword "${kw}" only partially matches article text (${describeMatch(result)})`,
          suggestion: 'Keyword should appear literally in the article',
        });
        break;

      case 'missing':
        issues.push({
          type: 'rule',
          section: 'writing',
          severity: 'warning',
          message: `Keyword "${kw}" not found in article text (${describeMatch(result)})`,
          suggestion: 'Keywords must be words or phrases that literally appear in the article',
        });
        break;
    }
  });

  // Q&A
  const qa = ww.qaChain || [];
  if (qa.length !== 4) {
    issues.push({ type: 'rule', section: 'writing', severity: 'error', message: `Expected exactly 4 Q&A questions, got ${qa.length}` });
  }
  qa.forEach((q, i) => {
    if (!q || q.trim().length === 0) {
      issues.push({ type: 'structure', section: 'writing', severity: 'error', message: `Q&A ${i + 1} is empty` });
    }
  });

  // Critical Thinking
  if (!ww.criticalThinking || ww.criticalThinking.trim().length === 0) {
    issues.push({ type: 'structure', section: 'writing', severity: 'error', message: 'Critical Thinking prompt is empty' });
  }

  return issues;
}
