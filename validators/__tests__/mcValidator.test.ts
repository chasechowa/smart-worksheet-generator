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

function makeQuestion(type: string, answer: string, options?: string[]): MCQuestion {
  return {
    id: `q${Math.random()}`,
    type: type as any,
    question: 'Test question?',
    options: options || ['Alpha', 'Beta', 'Gamma', 'Delta'],
    answer,
    explanation: 'Because it is correct.',
  };
}

describe('validateMC', () => {
  it('flags wrong question count', () => {
    const data = createMCData([makeQuestion('Main Idea', 'A')]);
    const { issues } = validateMC(data);
    expect(issues.some(i => i.message.includes('Expected 10'))).toBe(true);
  });

  it('strips option prefixes', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Finding Evidence' : 'Main Idea', 'Second', ['A. First', 'B. Second', 'C. Third', 'D. Fourth'])
    );
    const { fixedData, issues } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].options[0]).toBe('First');
    expect(fixedData.multipleChoice[0].answer).toBe('B');
    expect(issues.filter(i => i.severity === 'error').length).toBe(0);
  });

  it('converts answer text to letter', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Finding Evidence' : 'Main Idea', 'Gamma', ['Alpha', 'Beta', 'Gamma', 'Delta'])
    );
    const { fixedData } = validateMC(createMCData(questions));
    expect(fixedData.multipleChoice[0].answer).toBe('C');
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
      makeQuestion(i < 2 ? 'Finding Evidence' : 'Main Idea', ans, opts)
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
      makeQuestion(i < 2 ? 'Finding Evidence' : 'Main Idea', ans, opts)
    );
    const { fixedData } = validateMC(createMCData(questions));
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    fixedData.multipleChoice.forEach(q => { dist[q.answer as keyof typeof dist]++; });
    Object.values(dist).forEach(count => {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    });
  });

  it('detects duplicate options', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Finding Evidence' : 'Main Idea', 'Unique', ['Same', 'Same', 'Different', 'Unique'])
    );
    const { issues } = validateMC(createMCData(questions));
    expect(issues.some(i => i.message.includes('duplicate option'))).toBe(true);
  });

  it('warns when option lengths vary by more than 30%', () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion(i < 2 ? 'Finding Evidence' : 'Main Idea', 'Short', [
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
