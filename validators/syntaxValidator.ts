import type { WorksheetData, ValidationIssue } from '../types';

function similarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const distance = longer.split('').filter((c, i) => c !== shorter[i]).length + Math.abs(longer.length - shorter.length);
  return (longer.length - distance) / longer.length;
}

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

    // Check if original sentence appears in article (with similarity)
    const sentences = articleText.split(/[.!?]+/).map(s => s.trim());
    const bestMatch = sentences.reduce((best, sentence) => {
      const sim = similarity(item.original.toLowerCase(), sentence.toLowerCase());
      return sim > best.sim ? { sim, sentence } : best;
    }, { sim: 0, sentence: '' });

    if (bestMatch.sim < 0.5) {
      issues.push({
        type: 'rule',
        section: 'syntax',
        severity: 'warning',
        message: `Syntax item ${i + 1}: original sentence not closely matching article text`,
        suggestion: 'Sentence should be extracted or closely paraphrased from the article',
      });
    }

    if (!item.answer || item.answer.trim().length === 0) {
      issues.push({
        type: 'structure',
        section: 'syntax',
        severity: 'error',
        message: `Syntax item ${i + 1}: answer is empty`,
      });
    }
  });

  return issues;
}
