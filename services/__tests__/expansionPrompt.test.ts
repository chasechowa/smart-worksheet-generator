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
});
