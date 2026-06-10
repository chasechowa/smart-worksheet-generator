import type { WorksheetData, ValidationIssue } from '../types';
import { validateSummary } from './summaryValidator';
import { validateMC } from './mcValidator';
import { validateSyntax } from './syntaxValidator';
import { validateWriting } from './writingValidator';
import { validateKeys } from './keysValidator';

export function validateAll(data: WorksheetData, articleText: string): { issues: ValidationIssue[]; fixedData: WorksheetData } {
  const issues: ValidationIssue[] = [];

  // Global checks
  if (!data.title || data.title.trim().length === 0) {
    issues.push({ type: 'structure', section: 'global', severity: 'error', message: 'Worksheet title is empty' });
  }
  if (!data.articleSnippet || data.articleSnippet.trim().length === 0) {
    issues.push({ type: 'structure', section: 'global', severity: 'error', message: 'Article snippet is empty' });
  }

  // Section validators — each mutates data as needed to auto-fix warnings
  issues.push(...validateSummary(data, articleText));
  const mcResult = validateMC(data);
  issues.push(...mcResult.issues);
  let fixedData = mcResult.fixedData;
  issues.push(...validateSyntax(fixedData, articleText));
  issues.push(...validateWriting(fixedData, articleText));
  issues.push(...validateKeys(fixedData));

  return { issues, fixedData };
}

export * from './summaryValidator';
export * from './mcValidator';
export * from './syntaxValidator';
export * from './writingValidator';
export * from './keysValidator';
export * from './verbatimMatcher';
