import { describe, it, expect } from 'vitest';
import {
  validateSentenceInsertion,
  normalizeInsertionMarkers,
  normalizeInsertionAnswer,
  splitInsertionParagraph,
} from '../sentenceInsertionValidator';
import type { WorksheetData, SentenceInsertionQuestion } from '../../types';

const ARTICLE = [
  'The rainforest canopy blocks most sunlight from reaching the forest floor. Because of this, plants on the ground must compete for the little light that filters through. Some species have evolved enormous leaves to capture what they can. Others grow quickly and die back once the canopy closes.',
  'Scientists who study the canopy often use ropes and towers to reach the upper branches. Their surveys have revealed that the canopy itself supports a surprising variety of insects. Many of these species never descend to the ground at all. Protecting the canopy therefore means protecting species that most people never see.',
].join(' ');

const PARAGRAPH_ONE = 'The rainforest canopy blocks most sunlight from reaching the forest floor.[1] Because of this, plants on the ground must compete for the little light that filters through.[2] Some species have evolved enormous leaves to capture what they can.[3] Others grow quickly and die back once the canopy closes.[4]';

const PARAGRAPH_TWO = 'Scientists who study the canopy often use ropes and towers to reach the upper branches.[1] Their surveys have revealed that the canopy itself supports a surprising variety of insects.[2] Many of these species never descend to the ground at all.[3] Protecting the canopy therefore means protecting species that most people never see.[4]';

function makeItem(overrides: Partial<SentenceInsertionQuestion> = {}): SentenceInsertionQuestion {
  return {
    id: 'si1',
    sentence: 'This shortage of light also limits how tall the undergrowth can become.',
    paragraph: PARAGRAPH_ONE,
    answer: 2,
    explanation: 'Position 2 follows the cause it depends on.',
    ...overrides,
  };
}

function makeData(items?: SentenceInsertionQuestion[]): WorksheetData {
  return {
    title: 'Title',
    articleSnippet: 'snippet',
    summary: { paragraph: '[BLANK]', blanks: ['x'] },
    multipleChoice: [],
    sentenceInsertion: items,
    syntaxDeconstruction: [],
    writingWorkshop: { expansion: [], keywords: [], qaChain: [], criticalThinking: '' },
    keys: { summary: [], mc: {}, sentenceInsertion: {}, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
  };
}

const CLEAN_ITEMS: SentenceInsertionQuestion[] = [
  makeItem(),
  makeItem({
    id: 'si2',
    sentence: 'That dependence makes the upper branches a habitat worth protecting.',
    paragraph: PARAGRAPH_TWO,
    answer: 3,
  }),
];

describe('validateSentenceInsertion', () => {
  it('stays silent when the section was never requested', () => {
    expect(validateSentenceInsertion(makeData(undefined), ARTICLE, 'B1')).toEqual([]);
  });

  it('reports a wrong item count', () => {
    const issues = validateSentenceInsertion(makeData([makeItem()]), ARTICLE, 'B1');
    expect(issues.some(i => i.message.includes('Expected exactly 2'))).toBe(true);
  });

  it('accepts a clean pair', () => {
    const issues = validateSentenceInsertion(makeData(CLEAN_ITEMS), ARTICLE, 'B1');
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('errors when the paragraph is not verbatim from the article', () => {
    const items = [makeItem({ paragraph: PARAGRAPH_ONE.replace('enormous leaves', 'giant leaves') }), CLEAN_ITEMS[1]];
    const issues = validateSentenceInsertion(makeData(items), ARTICLE, 'B1');
    expect(issues.some(i => i.severity === 'error' && i.message.includes('not verbatim'))).toBe(true);
  });

  it('errors when the extra sentence already appears in the article', () => {
    const items = [makeItem({ sentence: 'Protecting the canopy therefore means protecting species that most people never see.' }), CLEAN_ITEMS[1]];
    const issues = validateSentenceInsertion(makeData(items), ARTICLE, 'B1');
    expect(issues.some(i => i.severity === 'error' && i.message.includes('already appears in the article'))).toBe(true);
  });

  it('errors on the wrong number of markers', () => {
    const items = [makeItem({ paragraph: 'Aaa bbb.[1] Ccc ddd.[2] Eee fff.[3]' }), CLEAN_ITEMS[1]];
    const issues = validateSentenceInsertion(makeData(items), ARTICLE, 'B1');
    expect(issues.some(i => i.severity === 'error' && i.message.includes('expected 4 position markers, got 3'))).toBe(true);
  });

  it('errors on duplicate marker labels', () => {
    const items = [makeItem({ paragraph: 'Aaa bbb.[1] Ccc ddd.[1] Eee fff.[3] Ggg hhh.[4]' }), CLEAN_ITEMS[1]];
    const issues = validateSentenceInsertion(makeData(items), ARTICLE, 'B1');
    expect(issues.some(i => i.message.includes('each appearing once'))).toBe(true);
  });

  it('renumbers out-of-order markers and remaps the answer by rank', () => {
    const item = makeItem({ paragraph: 'Aaa bbb.[2] Ccc ddd.[1] Eee fff.[3] Ggg hhh.[4]', answer: 1 });
    const issues = validateSentenceInsertion(makeData([item, CLEAN_ITEMS[1]]), ARTICLE, 'B1');
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('out of order'))).toBe(true);
    // Label [2] becomes [1]; [1] becomes [2]; the answer pointed at the label "1" -> now position 2.
    expect(item.paragraph.startsWith('Aaa bbb.[1] Ccc ddd.[2]')).toBe(true);
    expect(item.answer).toBe(2);
  });

  it('fixes a marker wedged inside a word', () => {
    const item = makeItem({ paragraph: 'The under[1]growth grows slowly. More text here.[2] Final words.[3] The last bit.[4]' });
    const issues = validateSentenceInsertion(makeData([item, CLEAN_ITEMS[1]]), ARTICLE, 'B1');
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('inside a word'))).toBe(true);
    expect(item.paragraph).toContain('under [1]growth');
  });

  it('errors on an out-of-range answer and coerces a string answer', () => {
    const bad = makeItem({ answer: 5 });
    const coerced = makeItem({ id: 'si2', sentence: CLEAN_ITEMS[1].sentence, paragraph: PARAGRAPH_TWO, answer: 'C' as any });
    const issues = validateSentenceInsertion(makeData([bad, coerced]), ARTICLE, 'B1');
    expect(issues.some(i => i.severity === 'error' && i.message.includes('is not a position 1-4'))).toBe(true);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('coerced to position 3'))).toBe(true);
    expect(coerced.answer).toBe(3);
  });
});

describe('insertion helpers', () => {
  it('normalizes bracket variants and inner spacing', () => {
    expect(normalizeInsertionMarkers('a［1］b[ 2 ]c')).toBe('a[1]b[2]c');
  });

  it('coerces answer forms and rejects garbage', () => {
    expect(normalizeInsertionAnswer(3)).toBe(3);
    expect(normalizeInsertionAnswer('3')).toBe(3);
    expect(normalizeInsertionAnswer('[3]')).toBe(3);
    expect(normalizeInsertionAnswer('position 3')).toBe(3);
    expect(normalizeInsertionAnswer('C')).toBe(3);
    expect(normalizeInsertionAnswer('Z')).toBeNull();
    expect(normalizeInsertionAnswer(0)).toBeNull();
    expect(normalizeInsertionAnswer(null)).toBeNull();
  });

  it('splits a paragraph into text and marker chunks', () => {
    const chunks = splitInsertionParagraph('Aaa.[1] Bbb [2] Ccc');
    expect(chunks).toEqual([
      { text: 'Aaa.', marker: null },
      { text: '', marker: 1 },
      { text: ' Bbb ', marker: null },
      { text: '', marker: 2 },
      { text: ' Ccc', marker: null },
    ]);
  });

  it('handles a marker at the very start and end', () => {
    const chunks = splitInsertionParagraph('[1] middle [2]');
    expect(chunks[0]).toEqual({ text: '', marker: 1 });
    expect(chunks[chunks.length - 1]).toEqual({ text: '', marker: 2 });
  });
});
