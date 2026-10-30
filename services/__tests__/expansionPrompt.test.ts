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
  });

  it('gives each difficulty its own word band and connector pool', () => {
    const a2 = buildWritingSectionPrompt('Article text', 'A2', options);
    expect(a2).toContain('6-14 words');
    expect(a2).toContain('and / but / because / so');
    expect(a2).not.toContain('insofar as');

    const b2 = buildWritingSectionPrompt('Article text', 'B2', options);
    expect(b2).toContain('11-20 words');
    expect(b2).toContain('provided that');
    expect(b2).not.toContain('insofar as');

    const c1 = buildWritingSectionPrompt('Article text', 'C1', options);
    expect(c1).toContain('14-24 words');
    expect(c1).toContain('insofar as');
  });
});
