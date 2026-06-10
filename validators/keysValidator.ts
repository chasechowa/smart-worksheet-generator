import type { WorksheetData, ValidationIssue } from '../types';

export function validateKeys(data: WorksheetData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { keys, multipleChoice, syntaxDeconstruction, writingWorkshop } = data;

  if (!keys) {
    issues.push({ type: 'structure', section: 'keys', severity: 'error', message: 'Keys section is missing' });
    return issues;
  }

  // MC keys
  const mcCount = (multipleChoice || []).length;
  const mcKeyCount = Object.keys(keys.mc || {}).length;
  if (mcKeyCount !== mcCount) {
    issues.push({
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: `MC key count (${mcKeyCount}) does not match question count (${mcCount})`,
    });
  }

  // Check each MC key is A/B/C/D and semantically matches the question
  const mcQuestions = multipleChoice || [];
  const mcMap = new Map(mcQuestions.map(q => [q.id, q]));
  Object.entries(keys.mc || {}).forEach(([qid, keyLetter]) => {
    if (!/^[A-D]$/.test(keyLetter)) {
      issues.push({
        type: 'rule',
        section: 'keys',
        severity: 'error',
        message: `MC key for ${qid} is "${keyLetter}", expected A/B/C/D`,
      });
      return;
    }

    // Semantic check: key letter must match the answer field (both are letters)
    const question = mcMap.get(qid);
    if (question) {
      const answerLetter = question.answer?.toUpperCase() || '';
      if (/^[A-D]$/.test(answerLetter) && answerLetter !== keyLetter) {
        issues.push({
          type: 'rule',
          section: 'keys',
          severity: 'error',
          message: `MC key for ${qid} is ${keyLetter}, but question's answer is ${answerLetter}`,
          suggestion: `Key should be ${answerLetter} to match the answer field`,
        });
      }
    }
  });

  // Syntax keys
  const syntaxCount = (syntaxDeconstruction || []).length;
  const syntaxKeyCount = (keys.syntaxDeconstruction || []).length;
  if (syntaxKeyCount !== syntaxCount) {
    issues.push({
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: `Syntax key count (${syntaxKeyCount}) does not match item count (${syntaxCount})`,
    });
  }

  // Expansion keys
  const expansionCount = (writingWorkshop?.expansion || []).length;
  const expansionKeyCount = (keys.expansion || []).length;
  if (expansionKeyCount !== expansionCount) {
    issues.push({
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: `Expansion key count (${expansionKeyCount}) does not match item count (${expansionCount})`,
    });
  }

  // Q&A keys
  const qaCount = (writingWorkshop?.qaChain || []).length;
  const qaKeyCount = (keys.qa || []).length;
  if (qaKeyCount !== qaCount) {
    issues.push({
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: `Q&A key count (${qaKeyCount}) does not match question count (${qaCount})`,
    });
  }

  return issues;
}
