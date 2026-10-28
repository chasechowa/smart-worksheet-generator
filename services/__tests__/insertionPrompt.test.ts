import { describe, expect, it } from 'vitest';
import { buildSentenceInsertionPrompt } from '../aiService';

describe('sentence insertion prompt', () => {
  it('requires an explicit referent and forbids conclusion-style [1] answers', () => {
    const prompt = buildSentenceInsertionPrompt('Article text', 'B2');
    expect(prompt).toContain('name its referent explicitly');
    expect(prompt).toContain('cannot be the answer at [1]');
    expect(prompt).toContain('could also serve as the paragraph');
  });
});
