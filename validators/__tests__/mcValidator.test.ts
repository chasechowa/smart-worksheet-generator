import { describe, it, expect } from 'vitest';
import { validateMC, countOptionWords, getOptionWordCounts, getOptionLengthViolations, isOptionLengthBalanced } from '../mcValidator';
import type { WorksheetData, MCQuestion } from '../../types';

function createMCData(questions: MCQuestion[]): WorksheetData {
  return {
    title: 'Test',
    articleSnippet: 'snippet',
    summary: { paragraph: '', blanks: [] },
    multipleChoice: questions,
    syntaxDeconstruction: [],
    writingWorkshop: { expansion: [], keywords: [], qaChain: [], criticalThinking: '' },
    keys: { summary: [], mc: {}, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
  };
}

import type { MCQuestionType } from '../../types';

function makeQuestion(type: MCQuestionType, answer: string, options?: string[]): MCQuestion {
  return {
    id: `q${Math.random()}`,
    type,
    question: 'Test question?',
    options: options || ['Alpha', 'Beta', 'Gamma', 'Delta'],
    answer,
    explanation: 'Because it is correct.',
  };
}

describe('validateMC', () => {
  it('flags wrong question count', () => {
    const data = createMCData([makeQuestion('Literal Comprehension', 'A')]);
    const { issues } = validateMC(data);
    expect(issues.some(i => i.message.includes('Expected 10'))).toBe(true);
  });

  it('strips option prefixes', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'Second', ['A. First', 'B. Second', 'C. Third', 'D. Fourth'])
    );
    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].options[0]).toBe('First');
    expect(fixedData.multipleChoice[0].answer).toBe('B');
    expect(issues.filter(i => i.severity === 'error').length).toBe(0);
  });

  it('converts legacy option-text answers to letters with warning', () => {    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'Gamma', ['Alpha', 'Beta', 'Gamma', 'Delta'])
    );
    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].answer).toBe('C');
    expect(issues.some(i => i.message.includes('auto-converted to letter'))).toBe(true);
  });

  it('auto-fixes uneven answer distribution by rotating options', () => {
    // Realistic data: answer text matches an option
    const opts = ['Small brains', 'Social hierarchies', 'Tool use', 'Night vision'];
    const answers = [
      'Small brains', 'Social hierarchies', 'Tool use', 'Night vision',
      'Small brains', 'Social hierarchies', 'Tool use', 'Night vision',
      'Small brains', 'Social hierarchies'
    ];
    const questions = answers.map((ans, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', ans, opts)
    );
    const { issues, fixedData } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('distribution uneven'))).toBe(false);
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    fixedData.multipleChoice.forEach(q => { dist[q.answer as keyof typeof dist]++; });
    Object.values(dist).forEach(count => {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    });
  });

  it('fixes 4-2-2-2 distribution via second pass', () => {
    // 4 A, 2 B, 2 C, 2 D — needs pass 2 to redistribute
    const opts = ['OptA', 'OptB', 'OptC', 'OptD'];
    const answers = ['A', 'A', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'];
    const questions = answers.map((ans, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', ans, opts)
    );
    const { fixedData } = validateMC(createMCData(questions));
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    fixedData.multipleChoice.forEach(q => { dist[q.answer as keyof typeof dist]++; });
    Object.values(dist).forEach(count => {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    });
  });

  it('remaps distractor metadata when rotating options', () => {
    const opts = ['OptA', 'OptB', 'OptC', 'OptD'];
    const answers = ['A', 'A', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'];
    const questions = answers.map((ans, i) => ({
      ...makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', ans, opts),
      distractors: {
        A: { pattern: 'Too Broad' as const, rationale: 'A plausible but overextended reading.' },
        B: { pattern: 'Too Narrow' as const, rationale: 'A plausible but too limited reading.' },
        C: { pattern: 'Too Strong' as const, rationale: 'A plausible but stronger claim than supported.' },
        D: { pattern: 'Unsupported Inference' as const, rationale: 'A plausible claim without direct support.' },
      },
    }));

    const { fixedData } = validateMC(createMCData(questions));
    const rotated = fixedData.multipleChoice.find(q => q.answer !== 'A');
    expect(rotated).toBeTruthy();
    expect(rotated?.distractors?.[rotated.answer]).toBeUndefined();
    expect(Object.keys(rotated?.distractors || {})).not.toContain(rotated?.answer);
  });

  it('removes distractor metadata attached to the correct answer', () => {
    const questions = Array.from({ length: 10 }, (_, i) => ({
      ...makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', i === 0 ? 'A' : 'B'),
      distractors: i === 0
        ? {
            A: { pattern: 'Unsupported Inference' as const, rationale: 'This belongs on a wrong option only.' },
            C: { pattern: 'Too Narrow' as const, rationale: 'A plausible but too limited reading.' },
            D: { pattern: 'Too Strong' as const, rationale: 'A plausible but stronger claim than supported.' },
          }
        : {
            A: { pattern: 'Too Broad' as const, rationale: 'A plausible but overextended reading.' },
            C: { pattern: 'Too Narrow' as const, rationale: 'A plausible but too limited reading.' },
            D: { pattern: 'Too Strong' as const, rationale: 'A plausible but stronger claim than supported.' },
          },
    }));

    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].distractors?.A).toBeUndefined();
    expect(fixedData.multipleChoice[0].distractors?.B).toBeDefined();
    expect(issues.some(i => i.message.includes('Removed distractor metadata'))).toBe(true);
    expect(issues.some(i => i.message.includes('Wrong option B is missing distractor metadata'))).toBe(false);
  });

  it('normalizes common distractor pattern aliases without warning noise', () => {
    const questions = Array.from({ length: 10 }, (_, i) => ({
      ...makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A'),
      distractors: {
        B: { pattern: 'Overstatement' as any, rationale: 'This exaggerates what the passage supports.' },
        C: { pattern: 'Unsupported' as any, rationale: 'This sounds plausible but lacks textual support.' },
        D: { pattern: 'Wrong focus' as any, rationale: 'This focuses on a related but incorrect point.' },
      },
    }));

    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].distractors?.B.pattern).toBe('Too Strong');
    expect(fixedData.multipleChoice[0].distractors?.C.pattern).toBe('Unsupported Inference');
    expect(fixedData.multipleChoice[0].distractors?.D.pattern).toBe('Wrong Scope');
    expect(issues.some(i => i.message.includes('unknown distractor pattern'))).toBe(false);
  });

  it('normalizes noisy distractor pattern labels without warning noise', () => {
    const noisyPatterns = [
      ['Overemphasis', 'Absolute', 'Opposite'],
      ['Misattribution', 'Vague', 'Contrary'],
      ['Overly Specific', 'Too Abstract', 'Not Mentioned'],
    ];
    const questions = Array.from({ length: 10 }, (_, i) => {
      const [b, c, d] = noisyPatterns[i % noisyPatterns.length];
      return {
        ...makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A'),
        distractors: {
          B: { pattern: b as any, rationale: 'Plausible but not the best supported answer.' },
          C: { pattern: c as any, rationale: 'Plausible but not the best supported answer.' },
          D: { pattern: d as any, rationale: 'Plausible but not the best supported answer.' },
        },
      };
    });

    const { fixedData, issues } = validateMC(createMCData(questions));
    const allowed = new Set(['Too Broad', 'Too Narrow', 'Too Strong', 'Partially True', 'Wrong Scope', 'Unsupported Inference', 'Reversed Logic']);
    Object.values(fixedData.multipleChoice[0].distractors || {}).forEach(meta => {
      expect(allowed.has(meta.pattern)).toBe(true);
    });
    expect(issues.some(i => i.message.includes('unknown distractor pattern'))).toBe(false);
  });

  it('autofills missing distractor metadata without warning noise', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A')
    );

    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(Object.keys(fixedData.multipleChoice[0].distractors || {}).sort()).toEqual(['B', 'C', 'D']);
    expect(issues.some(i => i.message.includes('Missing distractor metadata'))).toBe(false);
    expect(issues.some(i => i.message.includes('missing distractor metadata'))).toBe(false);
  });

  it('normalizes evidence pair links when exactly two Evidence Reasoning questions exist', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A')
    );
    questions[0].id = 'claim';
    questions[1].id = 'evidence';
    questions[0].evidencePairLink = { claimQuestionId: 'wrong', evidenceQuestionId: 'evidence' };
    questions[1].evidencePairLink = { claimQuestionId: 'claim', evidenceQuestionId: 'wrong' };

    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].evidencePairLink).toEqual({
      claimQuestionId: 'claim',
      evidenceQuestionId: 'evidence',
    });
    expect(fixedData.multipleChoice[1].evidencePairLink).toEqual({
      claimQuestionId: 'claim',
      evidenceQuestionId: 'evidence',
    });
    expect(issues.some(i => i.message.includes('Evidence pair link is inconsistent'))).toBe(false);
  });

  it('detects duplicate options', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'Unique', ['Same', 'Same', 'Different', 'Unique'])
    );
    const { issues } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('duplicate option'))).toBe(true);
  });

  it('reports malformed options without throwing', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A')
    );
    delete (questions[0] as any).options;

    expect(() => validateMC(createMCData(questions))).not.toThrow();
    const { issues, fixedData } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].options).toEqual([]);
    expect(issues.some(i => i.message.includes('Q1: Expected 4 options, got 0'))).toBe(true);
  });

  it('accepts letter-format answers cleanly without conversion warning', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'B', ['Alpha', 'Beta', 'Gamma', 'Delta'])
    );
    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].answer).toBe('B');
    expect(issues.some(i => i.message.includes('auto-converted'))).toBe(false);
  });

  it('warns when a distractor is more than 2 words away from the correct answer', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A', [
        'Short',                                  // 1 word (correct)
        'This distractor is far too long now',    // 6 words
        'Medium option',                          // 2 words
        'Brief',                                  // 1 word
      ])
    );
    const { issues } = validateMC(createMCData(questions));
    const warnings = issues.filter(i => i.message.includes('within 2 words'));
    expect(warnings.length).toBeGreaterThan(0);
    // Options may be rotated before this check, so assert on the counts, not the letter.
    expect(warnings.some(i => i.message.includes('7 words'))).toBe(true);
    expect(warnings.some(i => i.message.includes('correct option') && i.message.includes('1 word'))).toBe(true);
  });

  it('does not warn when every distractor is within 2 words of the correct answer', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A', [
        'Alpha',        // 1 (correct)
        'Beta chain',   // 2
        'Gamma ray now',// 3
        'Delta',        // 1
      ])
    );
    const { issues } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('within 2 words'))).toBe(false);
  });

  it('uses word count rather than character count', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A', [
        'Extraordinarily comprehensive reinterpretation', // 3 words, far longer in characters
        'Cats sleep now',                                  // 3 words
        'Dogs run fast',                                   // 3 words
        'Birds fly high',                                  // 3 words
      ])
    );
    const { issues } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('within 2 words'))).toBe(false);
  });

  it('accepts a lowercase answer and the exact tolerance boundary', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'a', [
        'Alpha',          // 1 (correct)
        'Beta chain now', // 3 — diff exactly 2
        'Gamma ray',      // 2
        'Delta',          // 1
      ])
    );
    const { issues } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('within 2 words'))).toBe(false);
  });

  it('skips the length check for malformed option sets', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'A', [
        'Alpha',
        'Beta',
        'Gamma',
      ])
    );
    const { issues } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('within 2 words'))).toBe(false);
  });
});

describe('option word-count helpers', () => {
  it('counts whitespace-delimited words and handles bad input', () => {
    expect(countOptionWords('')).toBe(0);
    expect(countOptionWords('   ')).toBe(0);
    expect(countOptionWords(' one  two\tthree ')).toBe(3);
    expect(countOptionWords("don't stop")).toBe(2);
    expect(countOptionWords(null)).toBe(0);
    expect(countOptionWords(42)).toBe(0);
  });

  it('resolves the correct option case-insensitively', () => {
    const counts = getOptionWordCounts(['one', 'two words', 'three words here', 'four'], 'b');
    expect(counts).not.toBeNull();
    expect(counts!.find(entry => entry.isCorrect)!.index).toBe(1);
    expect(counts!.map(entry => entry.words)).toEqual([1, 2, 3, 1]);
  });

  it('returns null for malformed option sets', () => {
    expect(getOptionWordCounts(['a', 'b'], 'A')).toBeNull();
    expect(getOptionWordCounts(['a', 'b', 'c', 'd'], 'E')).toBeNull();
    expect(getOptionWordCounts(undefined, 'A')).toBeNull();
  });

  it('balances at exactly the tolerance boundary', () => {
    expect(isOptionLengthBalanced(['one', 'two three', 'four five six', 'seven'], 'A')).toBe(true);
    expect(isOptionLengthBalanced(['one', 'two three four five', 'six', 'seven'], 'A')).toBe(false);
  });

  it('reports the violating option details', () => {
    const violations = getOptionLengthViolations(['short', 'one two three four five', 'two words', 'three words now'], 'A');
    expect(violations).toEqual([
      { index: 1, letter: 'B', words: 5, correctLetter: 'A', correctWords: 1, difference: 4 },
    ]);
  });
});

describe('answer distribution rotation', () => {
  function makeSkewedQuestions(): MCQuestion[] {
    const answers = ['A', 'A', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'];
    return answers.map((answer, index) => ({ ...makeQuestion('Inference', answer), id: `q${index + 1}` }));
  }

  it('balances a skewed set by default', () => {
    const { fixedData } = validateMC(createMCData(makeSkewedQuestions()), 'B1');
    expect(fixedData.multipleChoice.map(question => question.answer)).not.toEqual(['A', 'A', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D']);
  });

  it('keeps every answer untouched when rotation is disabled', () => {
    const { fixedData } = validateMC(createMCData(makeSkewedQuestions()), 'B1', { fixAnswerDistribution: false });
    expect(fixedData.multipleChoice.map(question => question.answer)).toEqual(['A', 'A', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D']);
  });
});
