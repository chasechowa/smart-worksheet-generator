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

  // Sentence insertion keys — only when the section is present, so old worksheets stay clean.
  if (Array.isArray(data.sentenceInsertion)) {
    const insertionItems = data.sentenceInsertion;
    const insertionKeys = keys.sentenceInsertion || {};
    const insertionKeyCount = Object.keys(insertionKeys).length;
    if (insertionKeyCount !== insertionItems.length) {
      issues.push({
        type: 'rule',
        section: 'keys',
        severity: 'error',
        message: `Sentence insertion key count (${insertionKeyCount}) does not match item count (${insertionItems.length})`,
      });
    }
    insertionItems.forEach((item, index) => {
      const value = insertionKeys[item.id];
      if (!Number.isInteger(value) || value < 1 || value > 4) {
        issues.push({
          type: 'rule',
          section: 'keys',
          severity: 'error',
          message: `Sentence insertion key for ${item.id || `item ${index + 1}`} is "${String(value)}", expected a position 1-4`,
        });
        return;
      }
      const expected = item.answer;
      if (Number.isInteger(expected) && expected >= 1 && expected <= 4 && expected !== value) {
        issues.push({
          type: 'rule',
          section: 'keys',
          severity: 'error',
          message: `Sentence insertion key for ${item.id} is ${value}, but the item's answer is ${expected}`,
          suggestion: `Key should be ${expected}`,
        });
      }
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
