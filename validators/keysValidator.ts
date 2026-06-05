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

    // Semantic check: key letter must point to the correct answer option
    const question = mcMap.get(qid);
    if (question) {
      const keyIdx = keyLetter.charCodeAt(0) - 65;
      const optionAtKey = question.options[keyIdx];
      const answerText = question.answer;

      // Answer may be a letter (already normalized) or the option text
      if (/^[A-D]$/i.test(answerText)) {
        const answerIdx = answerText.toUpperCase().charCodeAt(0) - 65;
        if (answerIdx !== keyIdx) {
          issues.push({
            type: 'rule',
            section: 'keys',
            severity: 'error',
            message: `MC key for ${qid} is ${keyLetter}, but question's answer is ${answerText.toUpperCase()}`,
            suggestion: `Key should be ${answerText.toUpperCase()} to match the answer field`,
          });
        }
      } else if (optionAtKey != null && optionAtKey.toLowerCase().trim() !== answerText.toLowerCase().trim()) {
        issues.push({
          type: 'rule',
          section: 'keys',
          severity: 'warning',
          message: `MC key for ${qid} is ${keyLetter} ("${optionAtKey}"), but answer field is "${answerText}"`,
          suggestion: 'Key letter should point to the option matching the answer field',
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
