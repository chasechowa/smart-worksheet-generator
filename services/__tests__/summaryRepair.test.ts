import { describe, it, expect } from 'vitest';
import { isCompleteSummary, repairSummary } from '../aiService';

describe('repairSummary', () => {
  it('injects answers verbatim into a paragraph that has no [BLANK] tokens', () => {
    const result = repairSummary({
      paragraph: 'Studies show that regular sleep improves memory, while multitasking can reduce concentration.',
      blanks: ['regular sleep', 'concentration'],
    });
    expect(result.blanks).toEqual(['regular sleep', 'concentration']);
    expect(result.paragraph).toBe('Studies show that [BLANK] improves memory, while multitasking can reduce [BLANK].');
  });

  it('injects only the answers still missing from a partially blanked paragraph', () => {
    const result = repairSummary({
      paragraph: 'Studies show that [BLANK] improves memory, while multitasking can reduce concentration.',
      blanks: ['regular sleep', 'concentration'],
    });
    expect(result.blanks).toEqual(['regular sleep', 'concentration']);
    expect(result.paragraph).toBe('Studies show that [BLANK] improves memory, while multitasking can reduce [BLANK].');
  });

  it('trims answers that cannot be placed verbatim in the paragraph', () => {
    const result = repairSummary({
      paragraph: 'Studies show that rest improves memory and multitasking reduces focus.',
      blanks: ['regular sleep', 'concentration'],
    });
    // Neither answer appears verbatim -> nothing injected, list trimmed to match [BLANK] count (0).
    expect(result.paragraph).toBe('Studies show that rest improves memory and multitasking reduces focus.');
    expect(result.blanks).toEqual([]);
  });

  it('leaves an already-consistent summary unchanged', () => {
    const result = repairSummary({
      paragraph: 'Studies show that [BLANK] improves memory.',
      blanks: ['regular sleep'],
    });
    expect(result.paragraph).toBe('Studies show that [BLANK] improves memory.');
    expect(result.blanks).toEqual(['regular sleep']);
  });

  it('normalizes numbered blank tokens to a bare [BLANK]', () => {
    const result = repairSummary({
      paragraph: 'Study shows that [BLANK1] helps and [BLANK2] hurts.',
      blanks: ['rest', 'focus'],
    });
    expect(result.paragraph).toBe('Study shows that [BLANK] helps and [BLANK] hurts.');
    expect(result.blanks).toEqual(['rest', 'focus']);
  });
});

describe('isCompleteSummary', () => {
  const article = 'Alpha beta gamma delta epsilon are important ideas in this article.';

  it('accepts exactly five distinct verbatim answers', () => {
    expect(isCompleteSummary({
      paragraph: '[BLANK] [BLANK] [BLANK] [BLANK] [BLANK]',
      blanks: ['Alpha', 'beta', 'gamma', 'delta', 'epsilon'],
    }, article, 3)).toBe(true);
  });

  it('rejects fewer than five blanks even when paragraph and answers match', () => {
    expect(isCompleteSummary({
      paragraph: '[BLANK]',
      blanks: ['Alpha'],
    }, article, 3)).toBe(false);
  });

  it('rejects duplicate or non-verbatim answers', () => {
    expect(isCompleteSummary({
      paragraph: '[BLANK] [BLANK] [BLANK] [BLANK] [BLANK]',
      blanks: ['Alpha', 'beta', 'gamma', 'delta', 'delta'],
    }, article, 3)).toBe(false);
    expect(isCompleteSummary({
      paragraph: '[BLANK] [BLANK] [BLANK] [BLANK] [BLANK]',
      blanks: ['Alpha', 'beta', 'gamma', 'delta', 'missing'],
    }, article, 3)).toBe(false);
  });
});
