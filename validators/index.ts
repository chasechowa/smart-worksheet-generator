import type { WorksheetData, ValidationIssue, Difficulty } from '../types';
import { validateSummary } from './summaryValidator';
import { validateMC, type MCValidationOptions } from './mcValidator';
import { validateSyntax } from './syntaxValidator';
import { validateSentenceInsertion } from './sentenceInsertionValidator';
import { validateWriting } from './writingValidator';
import { validateKeys } from './keysValidator';
import { validateC1Boundaries } from './c1Validator';

export function validateAll(data: WorksheetData, articleText: string, difficulty?: Difficulty, options?: MCValidationOptions): { issues: ValidationIssue[]; fixedData: WorksheetData } {
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
  const mcResult = validateMC(data, difficulty, options);
  issues.push(...mcResult.issues);
  let fixedData = mcResult.fixedData;
  if (difficulty === 'C1') {
    issues.push(...validateC1Boundaries(fixedData.multipleChoice || [], articleText));
  }
  issues.push(...validateSyntax(fixedData, articleText));
  issues.push(...validateSentenceInsertion(fixedData, articleText, difficulty));
  issues.push(...validateWriting(fixedData, articleText));
  issues.push(...validateKeys(fixedData));

  return { issues, fixedData };
}

export * from './summaryValidator';
export * from './mcValidator';
export * from './syntaxValidator';
export * from './sentenceInsertionValidator';
export * from './writingValidator';
export * from './keysValidator';
export * from './verbatimMatcher';
export * from './c1Validator';
