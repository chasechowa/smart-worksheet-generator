import type { WorksheetData, ValidationResult, Difficulty } from '../types';
import { validateAll } from '../validators';
import type { MCValidationOptions } from '../validators/mcValidator';

export function validateWorksheet(data: WorksheetData, articleText: string, difficulty?: Difficulty, options?: MCValidationOptions): ValidationResult {
  const { issues, fixedData } = validateAll(data, articleText, difficulty, options);

  const errors = issues.filter(i => i.severity === 'error');

  // Auto-fix tracking: if any options were stripped or answers converted
  const autoFixed = JSON.stringify(fixedData.multipleChoice) !== JSON.stringify(data.multipleChoice);

  // Attach _meta
  const enrichedData: WorksheetData = {
    ...fixedData,
    _meta: {
      generatedAt: data._meta?.generatedAt || Date.now(),
      provider: data._meta?.provider || 'deepseek',
      model: data._meta?.model || 'unknown',
      validated: errors.length === 0,
      validationIssues: issues.map(i => `[${i.severity.toUpperCase()}] ${i.section}: ${i.message}`),
    },
  };

  return {
    valid: errors.length === 0,
    issues,
    autoFixed,
    data: enrichedData,
  };
}
