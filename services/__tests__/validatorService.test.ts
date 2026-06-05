import { describe, it, expect } from 'vitest';
import { validateWorksheet } from '../validatorService';
import type { WorksheetData } from '../../types';

function createEmptyWorksheet(): WorksheetData {
  return {
    title: '',
    articleSnippet: '',
    summary: { paragraph: '', blanks: [] },
    multipleChoice: [],
    syntaxDeconstruction: [],
    writingWorkshop: { expansion: [], keywords: [], qaChain: [], criticalThinking: '' },
    keys: { summary: [], mc: {}, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
  };
}

const articleText = 'The quick brown fox jumps over the lazy dog.';

describe('validatorService', () => {
  it('returns invalid for empty worksheet', () => {
    const result = validateWorksheet(createEmptyWorksheet(), articleText);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(i => i.section === 'global')).toBe(true);
  });

  it('returns autoFixed true when mc options are stripped', () => {
    const data: WorksheetData = {
      ...createEmptyWorksheet(),
      title: 'Test',
      articleSnippet: 'snippet',
      summary: { paragraph: 'The [BLANK] fox', blanks: ['quick'] },
      multipleChoice: Array.from({ length: 10 }, (_, i) => ({
        id: `q${i}`,
        type: i < 2 ? 'Finding Evidence' : 'Main Idea',
        question: 'Q?',
        options: ['A. One', 'B. Two', 'C. Three', 'D. Four'],
        answer: 'B',
        explanation: 'Exp',
      })),
      syntaxDeconstruction: [
        { id: 's1', original: 'The quick brown fox jumps over the lazy dog', answer: 'The fox jumps.' },
        { id: 's2', original: 'Another sentence here', answer: 'Another.' },
      ],
      writingWorkshop: {
        expansion: Array.from({ length: 4 }, () => ({ id: 'e1', fact: 'Fact', conjunctions: ['however'], sampleAnswer: '' })),
        keywords: ['quick', 'fox', 'jumps', 'dog', 'brown'],
        qaChain: ['Q1?', 'Q2?', 'Q3?', 'Q4?'],
        criticalThinking: 'Think critically.',
      },
      keys: {
        summary: ['quick'],
        mc: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`q${i}`, 'B'])),
        syntaxDeconstruction: ['ans1', 'ans2'],
        expansion: ['a1', 'a2', 'a3', 'a4'],
        qa: ['a1', 'a2', 'a3', 'a4'],
        critical: 'Guide',
      },
    };
    const result = validateWorksheet(data, articleText);
    expect(result.autoFixed).toBe(true);
    expect(result.data.multipleChoice[0].options[0]).toBe('One');
  });
});
