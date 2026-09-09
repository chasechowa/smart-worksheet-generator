import { describe, it, expect } from 'vitest';
import { validateSummary } from '../summaryValidator';
import type { WorksheetData } from '../../types';

function createBaseData(summary: Partial<WorksheetData['summary']> = {}, keys?: string[]): WorksheetData {
  return {
    title: 'Test',
    articleSnippet: 'snippet',
    summary: { paragraph: '', blanks: [], ...summary },
    multipleChoice: [],
    syntaxDeconstruction: [],
    writingWorkshop: { expansion: [], keywords: [], qaChain: [], criticalThinking: '' },
    keys: { summary: keys || [], mc: {}, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
  };
}

const articleText = 'The quick brown fox jumps over the lazy dog. Climate change is a serious issue.';

describe('validateSummary', () => {
  it('detects missing blanks', () => {
    const data = createBaseData({ paragraph: 'No blanks here' });
    const issues = validateSummary(data, articleText);
    expect(issues.some(i => i.message.includes('no [BLANK]'))).toBe(true);
  });

  it('detects mismatched blanks count', () => {
    const data = createBaseData({ paragraph: 'One [BLANK] two [BLANK]', blanks: ['one'] });
    const issues = validateSummary(data, articleText);
    expect(issues.some(i => i.message.includes('does not match'))).toBe(true);
  });

  it('normalizes numbered blank tokens', () => {
    const data = createBaseData(
      { paragraph: 'The [BLANK1] fox [BLANK2] over the dog', blanks: ['quick brown', 'jumps'] },
      ['quick brown', 'jumps']
    );
    const issues = validateSummary(data, articleText);
    expect(data.summary.paragraph).toBe('The [BLANK] fox [BLANK] over the dog');
    expect(issues.some(i => i.message.includes('Expected exactly 5 summary blanks'))).toBe(true);
  });

  it('auto-truncates blank exceeding 3 words', () => {
    const data = createBaseData({ paragraph: 'A [BLANK]', blanks: ['one two three four'] }, ['one two three four']);
    const issues = validateSummary(data, articleText);
    // Blank should be truncated, no warning emitted
    expect(data.summary.blanks[0]).toBe('one two three');
    expect(issues.some(i => i.message.includes('exceeds 3 words'))).toBe(false);
  });

  it('passes valid summary', () => {
    const data = createBaseData(
      { paragraph: 'The [BLANK] fox [BLANK] over the [BLANK]. [BLANK] change is a [BLANK] issue.', blanks: ['quick brown', 'jumps', 'lazy dog', 'Climate', 'serious'] },
      ['quick brown', 'jumps', 'lazy dog', 'Climate', 'serious']
    );
    const issues = validateSummary(data, articleText);
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('rejects a structurally consistent summary with fewer than five blanks', () => {
    const data = createBaseData(
      { paragraph: 'The [BLANK] fox [BLANK] over the dog', blanks: ['quick brown', 'jumps'] },
      ['quick brown', 'jumps']
    );
    const issues = validateSummary(data, articleText);
    expect(issues.some(i => i.message.includes('Expected exactly 5 summary blanks'))).toBe(true);
  });
});
