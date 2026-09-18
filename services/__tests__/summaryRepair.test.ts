import { describe, it, expect } from 'vitest';
import { ensureFiveBlanks, isCompleteSummary, repairSummary } from '../aiService';

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

  it('requires all five B2 coverage roles from at least three source areas', () => {
    const summary = {
      paragraph: '[BLANK] [BLANK] [BLANK] [BLANK] [BLANK]',
      blanks: ['Alpha', 'beta', 'gamma', 'delta', 'epsilon'],
    };
    const targets = [
      { answer: 'Alpha', role: 'central-concept' as const, sourceArea: 'P1' },
      { answer: 'beta', role: 'cause-or-mechanism' as const, sourceArea: 'P2' },
      { answer: 'gamma', role: 'key-development' as const, sourceArea: 'P3' },
      { answer: 'delta', role: 'contrast-or-limitation' as const, sourceArea: 'P4' },
      { answer: 'epsilon', role: 'result-or-conclusion' as const, sourceArea: 'P5' },
    ];
    expect(isCompleteSummary(summary, article, 3, targets)).toBe(true);
    expect(isCompleteSummary(summary, article, 3, targets.map(target => ({ ...target, sourceArea: 'P1' })))).toBe(false);
  });
});

describe('ensureFiveBlanks', () => {
  const article = 'Photographers use different techniques to tell stories about animals and nature. Saving species is important because every animal is a link in nature.';

  it('tops up to exactly five distinct blanks drawn from the article', () => {
    const result = ensureFiveBlanks(
      'Photographers use different techniques to tell stories about [BLANK] and nature.',
      ['animals'],
      article,
      3,
    );
    expect(result.blanks).toHaveLength(5);
    expect(result.paragraph.match(/\[BLANK\]/g) || []).toHaveLength(5);
    expect(new Set(result.blanks.map(blank => blank.toLowerCase())).size).toBe(5);
    const lower = article.toLowerCase();
    result.blanks.forEach(blank => expect(lower.includes(blank.toLowerCase())).toBe(true));
  });

  it('leaves an already-complete five-blank summary unchanged', () => {
    const paragraph = '[BLANK] [BLANK] [BLANK] [BLANK] [BLANK]';
    const blanks = ['Photographers', 'techniques', 'stories', 'animals', 'nature'];
    const result = ensureFiveBlanks(paragraph, blanks, article, 3);
    expect(result.paragraph).toBe(paragraph);
    expect(result.blanks).toEqual(blanks);
  });
});
