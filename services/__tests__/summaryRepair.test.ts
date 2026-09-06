import { describe, it, expect } from 'vitest';
import { repairSummary } from '../aiService';

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
