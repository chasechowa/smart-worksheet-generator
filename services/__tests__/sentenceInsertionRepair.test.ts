import { describe, it, expect } from 'vitest';
import { repairSentenceInsertionItems } from '../aiService';

const goodParagraph = 'Aaa bbb.[1] Ccc ddd.[2] Eee fff.[3] Ggg hhh.[4]';

describe('repairSentenceInsertionItems', () => {
  it('returns an empty array for non-array input', () => {
    expect(repairSentenceInsertionItems(undefined)).toEqual([]);
    expect(repairSentenceInsertionItems(null)).toEqual([]);
    expect(repairSentenceInsertionItems({ nope: true })).toEqual([]);
  });

  it('trims strings, fills ids, and coerces a string answer', () => {
    const result = repairSentenceInsertionItems([
      { sentence: '  Extra one.  ', paragraph: `  ${goodParagraph}  `, answer: '3', explanation: '  why  ' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('si1');
    expect(result[0].sentence).toBe('Extra one.');
    expect(result[0].paragraph).toBe(goodParagraph);
    expect(result[0].answer).toBe(3);
    expect(result[0].explanation).toBe('why');
  });

  it('keeps an unreadable answer as the 0 sentinel for the validator to flag', () => {
    const result = repairSentenceInsertionItems([{ sentence: 'S', paragraph: goodParagraph, answer: 'wat' }]);
    expect(result[0].answer).toBe(0);
  });

  it('drops items with no sentence, no paragraph, or no markers', () => {
    const result = repairSentenceInsertionItems([
      { sentence: '', paragraph: goodParagraph, answer: 1 },
      { sentence: 'S', paragraph: '   ', answer: 1 },
      { sentence: 'S', paragraph: 'A paragraph with no markers at all.', answer: 1 },
    ]);
    expect(result).toEqual([]);
  });

  it('keeps an item with only some markers (validator flags the count)', () => {
    const result = repairSentenceInsertionItems([{ sentence: 'S', paragraph: 'Aaa.[1] Bbb.[2]', answer: 1 }]);
    expect(result).toHaveLength(1);
    expect(result[0].paragraph).toBe('Aaa.[1] Bbb.[2]');
  });

  it('caps the result at two items', () => {
    const result = repairSentenceInsertionItems([
      { sentence: 'A', paragraph: goodParagraph, answer: 1 },
      { sentence: 'B', paragraph: goodParagraph, answer: 2 },
      { sentence: 'C', paragraph: goodParagraph, answer: 3 },
    ]);
    expect(result.map(item => item.id)).toEqual(['si1', 'si2']);
  });

  it('preserves an explicit id and optional source reference', () => {
    const result = repairSentenceInsertionItems([
      { id: 'custom', sentence: 'S', paragraph: goodParagraph, answer: 2, sourceParagraphRef: ' Paragraph 3 ' },
    ]);
    expect(result[0].id).toBe('custom');
    expect(result[0].sourceParagraphRef).toBe('Paragraph 3');
  });
});
