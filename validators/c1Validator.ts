/**
 * C1 hard-boundary validator.
 *
 * These checks catch low-level question shapes that often slip through prompt-only
 * generation. They are intentionally stricter than the generic MC validator.
 */
import type { MCQuestion, ValidationIssue } from '../types';

const WEAK_STEM_PATTERNS: RegExp[] = [
  /^according\s+to\s+the\s+passage/i,
  /^what\s+role\s+does/i,
  /^what\s+is\s+one\s+key\s+difference/i,
  /^when\s+did/i,
  /^where\s+did/i,
  /^which\s+of\s+the\s+following\s+is\s+true/i,
  /^in\s+paragraph\s+\d+,\s+the\s+word\s+/i,
];

const BANNED_VOCAB_WORDS = new Set([
  'steady', 'popular', 'difficult', 'route', 'team', 'challenge',
  'race', 'sport', 'long', 'strong', 'fast', 'easy', 'hard', 'big',
  'small', 'good', 'bad', 'nice', 'important', 'interesting', 'happy',
  'sad', 'angry', 'old', 'new', 'high', 'low', 'rich', 'poor',
  'basic', 'key', 'vital', 'deep', 'main', 'common', 'different',
  'similar', 'various', 'certain', 'specific', 'particular',
]);

const MAX_VERBATIM_WORDS = 6;

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function validateC1Boundaries(
  questions: MCQuestion[],
  articleText: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const articleWords = normalizeWords(articleText);

  const literalCount = questions.filter(q => q.type === 'Literal Comprehension').length;
  if (literalCount > 1) {
    issues.push({
      type: 'rule',
      section: 'mc',
      severity: 'error',
      message: `C1: Too many literal comprehension questions (${literalCount}). Maximum 1 allowed. Recommended: 0.`,
      suggestion: 'Convert excess literal questions to Inference or Structure / Function / Synthesis.',
    });
  }

  for (const q of questions) {
    for (const pattern of WEAK_STEM_PATTERNS) {
      if (pattern.test(q.question.trim())) {
        issues.push({
          type: 'rule',
          section: 'mc',
          severity: 'error',
          message: `C1: Question ${q.id} has a weak stem opener: "${q.question.slice(0, 60)}..."`,
          suggestion: 'Rewrite using analytical or inferential phrasing. Avoid "According to...", "What role does...", "When did...", etc.',
        });
        break;
      }
    }

    const needsMultiEvidence = q.type === 'Inference' || q.type === 'Structure / Function / Synthesis';
    if (needsMultiEvidence) {
      const evidenceCount = q.evidence?.length || 0;
      if (evidenceCount < 2) {
        issues.push({
          type: 'rule',
          section: 'mc',
          severity: 'warning',
          message: `C1: ${q.id} (${q.type}) has only ${evidenceCount} evidence reference(s). C1 inference requires at least 2.`,
          suggestion: 'Cite at least 2 paragraph or sentence references that together support the answer.',
        });
      }

      const steps = q.reasoningSteps?.length || 0;
      if (steps < 2) {
        issues.push({
          type: 'rule',
          section: 'mc',
          severity: 'warning',
          message: `C1: ${q.id} (${q.type}) has only ${steps} reasoning step(s). C1 requires at least 2.`,
          suggestion: 'Provide at least 2 reasoning steps showing the inference chain.',
        });
      }
    }

    if (q.type === 'Vocabulary in Context') {
      const stemWords = normalizeWords(q.question);
      const options = Array.isArray(q.options) ? q.options : [];
      for (const word of stemWords) {
        if (BANNED_VOCAB_WORDS.has(word)) {
          issues.push({
            type: 'rule',
            section: 'mc',
            severity: 'error',
            message: `C1: Vocabulary question ${q.id} targets "${word}" - too low-level for C1.`,
            suggestion: 'Choose an abstract, academic, or context-dependent word. If none is available, replace this with Structure / Function / Synthesis.',
          });
          break;
        }
      }

      for (const opt of options) {
        const lowLevelCount = normalizeWords(opt).filter(w => BANNED_VOCAB_WORDS.has(w)).length;
        if (lowLevelCount > 0) {
          issues.push({
            type: 'rule',
            section: 'mc',
            severity: 'warning',
            message: `C1: Vocab option in ${q.id} contains low-level word(s). All options should be C1/C2 academic vocabulary.`,
          });
          break;
        }
      }
    }

    if (q.type === 'Evidence Reasoning' && !q.evidencePairLink) {
      issues.push({
        type: 'rule',
        section: 'mc',
        severity: 'error',
        message: `C1: Evidence Reasoning ${q.id} missing evidencePairLink. Must be linked to another Evidence Reasoning question.`,
        suggestion: 'Add evidencePairLink with claimQuestionId and evidenceQuestionId.',
      });
    }

    if (q.type !== 'Vocabulary in Context' && q.type !== 'Evidence Reasoning') {
      const options = Array.isArray(q.options) ? q.options : [];
      const correctOption = options.find((_, idx) =>
        String.fromCharCode(65 + idx) === q.answer?.toUpperCase()
      );
      if (correctOption) {
        const answerText = normalizeWords(correctOption).join(' ');
        for (let i = 0; i <= articleWords.length - MAX_VERBATIM_WORDS; i++) {
          const slice = articleWords.slice(i, i + MAX_VERBATIM_WORDS).join(' ');
          if (answerText.includes(slice)) {
            issues.push({
              type: 'rule',
              section: 'mc',
              severity: 'error',
              message: `C1: ${q.id} correct answer copies ${MAX_VERBATIM_WORDS}+ consecutive words from passage. Paraphrase required.`,
              suggestion: 'Rewrite the correct answer using different wording from the passage.',
            });
            break;
          }
        }
      }
    }

    if (q.distractors) {
      const wrongLetters = ['A', 'B', 'C', 'D'].filter(l => l !== q.answer?.toUpperCase());
      for (const letter of wrongLetters) {
        const d = q.distractors[letter];
        if (!d || !d.pattern || !d.rationale || d.rationale.trim().length < 10) {
          issues.push({
            type: 'rule',
            section: 'mc',
            severity: 'warning',
            message: `C1: ${q.id} distractor ${letter} has insufficient trap analysis. Pattern and detailed rationale required.`,
            suggestion: 'Each wrong option must explain why a student might choose it based on a specific misreading.',
          });
        }
      }
    }
  }

  return issues;
}
