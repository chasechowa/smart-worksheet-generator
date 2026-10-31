import type { WorksheetData, ValidationIssue, ExpansionItem, Difficulty } from '../types';
import { findVerbatimMatch, describeMatch } from './verbatimMatcher';
import { findExpansionLevelProblems, findExpansionContinuationProblems } from './expansionRules';

const DEFAULT_CONJUNCTIONS = ['however', 'therefore', 'moreover', 'consequently'];

const CLAUSE_LINKER_RE = /\b(while|whereas|although|though|because|unless|so that|in order that)\b/i;
const COMMA_COORDINATOR_RE = /,\s*(and|but|so|or|yet)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A usable sentence-expansion fact is ONE independent clause. If it already
 * contains the relation the student must add (a connector, a result/contrast
 * clause, or a comma coordinator), there is nothing left to expand.
 */
export function findExpansionFactProblems(fact: string, conjunctions: string[] = []): string[] {
  const problems: string[] = [];
  const text = String(fact ?? '').trim();
  if (!text) return ['fact is empty'];

  const offered = (conjunctions || [])
    .map(conjunction => String(conjunction ?? '').trim())
    .filter(Boolean)
    .filter(conjunction => new RegExp(`\\b${escapeRegExp(conjunction)}\\b`, 'i').test(text));
  if (offered.length > 0) {
    problems.push(`fact already contains offered conjunction "${offered[0]}"`);
  }

  const coordinator = COMMA_COORDINATOR_RE.exec(text);
  if (coordinator) {
    problems.push(`fact already joins clauses with ", ${coordinator[1]}"`);
  }

  const linker = CLAUSE_LINKER_RE.exec(text);
  if (linker) {
    problems.push(`fact already contains the clause linker "${linker[1]}"`);
  }

  return problems;
}

export function findExpansionProblems(item: ExpansionItem): string[] {
  return [
    ...findExpansionFactProblems(item.fact, item.conjunctions),
    ...findExpansionContinuationProblems(item),
  ];
}

export function findInvalidExpansionIds(items: ExpansionItem[]): string[] {
  return (items || [])
    .filter(item => findExpansionProblems(item).length > 0)
    .map(item => item.id)
    .filter(Boolean);
}

export function validateWriting(data: WorksheetData, articleText: string, difficulty?: Difficulty): ValidationIssue[] {
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

    const factProblems = findExpansionFactProblems(ex.fact || '', ex.conjunctions || []);
    if (factProblems.length > 0) {
      issues.push({
        type: 'rule',
        section: 'writing',
        severity: 'warning',
        message: `Expansion ${i + 1}: ${factProblems[0]}; the fact already contains the logical link, so there is nothing to expand`,
        suggestion: 'Make fact ONE independent clause; put the relation only in sampleAnswer.',
      });
    }

    const continuationProblems = findExpansionContinuationProblems(ex);
    if (continuationProblems.length > 0) {
      issues.push({
        type: 'rule',
        section: 'writing',
        severity: 'warning',
        message: `Expansion ${i + 1}: ${continuationProblems[0]}`,
        suggestion: 'Offer only connectors you can continue naturally; give one continuation per connector.',
      });
    }

    const levelProblems = difficulty ? findExpansionLevelProblems(ex, difficulty) : [];
    if (levelProblems.length > 0) {
      issues.push({
        type: 'rule',
        section: 'writing',
        severity: 'warning',
        message: `Expansion ${i + 1}: ${levelProblems.join('; ')}`,
        suggestion: `Match the fact length and connector pool to ${difficulty}.`,
      });
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
