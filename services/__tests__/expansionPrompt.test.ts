import { describe, expect, it } from 'vitest';
import { buildWritingSectionPrompt } from '../aiService';
import type { GenerationOptions } from '../../types';

const options: GenerationOptions = {
  summary: false,
  mc: false,
  sentenceInsertion: false,
  syntaxDeconstruction: false,
  writing_expansion: true,
  writing_keywords: false,
  writing_qa: false,
  writing_critical: false,
};

describe('sentence expansion prompt', () => {
  it('requires one-clause facts and a non-prefilled continuation', () => {
    const prompt = buildWritingSectionPrompt('Article text', 'B2', options);
    expect(prompt).toContain('independent clause');
    expect(prompt).toContain('No offered connector may already appear');
    expect(prompt).toContain('sampleAnswer = fact + ONE offered connector');
    expect(prompt).toContain('continuations');
    expect(prompt).toContain('different logical relations');
    expect(prompt).toContain('not a whitelist');
    expect(prompt).toContain('exactly ONE of the three connectors');
  });

  it('treats each difficulty as a menu of functions and examples, not a fixed pool', () => {
    const a2 = buildWritingSectionPrompt('Article text', 'A2', options);
    expect(a2).toContain('fact 6-16 words');
    expect(a2).toContain('addition');
    expect(a2).not.toContain('insofar as');

    const b2 = buildWritingSectionPrompt('Article text', 'B2', options);
    expect(b2).toContain('fact 10-22 words');
    expect(b2).toContain('whereas');

    const c1 = buildWritingSectionPrompt('Article text', 'C1', options);
    expect(c1).toContain('fact 12-26 words');
    expect(c1).toContain('insofar as');
  });
});
