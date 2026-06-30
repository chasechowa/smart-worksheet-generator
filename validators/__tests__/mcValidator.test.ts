import { describe, it, expect } from 'vitest';
import { validateMC } from '../mcValidator';
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

  it('converts legacy option-text answers to letters with warning', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
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

  it('warns when option lengths vary by more than 30%', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Evidence Reasoning' : 'Literal Comprehension', 'Short', [
        'Short',
        'A much longer option that is way more verbose',
        'Medium length option here',
        'Another medium option'
      ])
    );
    const { issues } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('Option lengths vary'))).toBe(true);
  });
});
