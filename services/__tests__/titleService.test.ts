import { describe, expect, it } from 'vitest';
import { buildTitlePrompt, deriveArticleTitle, resolveWorksheetTitle } from '../titleService';

describe('deriveArticleTitle', () => {
  it('uses a short first line as the title', () => {
    const article = 'The Rise of Usership\n\nDo you need to own a phone? A sofa? Many people now rent.';
    expect(deriveArticleTitle(article)).toBe('The Rise of Usership');
  });

  it('strips a markdown heading marker', () => {
    expect(deriveArticleTitle('# The Rise of Usership\n\nBody text.')).toBe('The Rise of Usership');
  });

  it('rejects a full-sentence opening', () => {
    const article = 'Do you need to own a phone? A sofa? Some people want to buy things and use them.';
    expect(deriveArticleTitle(article)).toBeNull();
  });

  it('rejects an over-long first line', () => {
    const article = 'This is a very long opening line that clearly runs on and on and keeps adding more words without ever stopping.';
    expect(deriveArticleTitle(article)).toBeNull();
  });
});

describe('resolveWorksheetTitle', () => {
  it('prefers the summary title, then the generated title, then the first line', () => {
    expect(resolveWorksheetTitle('Summary title', 'Generated title', 'First line title')).toBe('Summary title');
    expect(resolveWorksheetTitle('', 'Generated title', 'First line title')).toBe('Generated title');
    expect(resolveWorksheetTitle('', '', 'First line title')).toBe('First line title');
    expect(resolveWorksheetTitle('', '', 'A long sentence that cannot be a title because it keeps going and going')).toBe('Untitled Worksheet');
  });
});

describe('buildTitlePrompt', () => {
  it('asks for a compact JSON title', () => {
    const prompt = buildTitlePrompt('Article body');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('3-8 words');
  });
});
