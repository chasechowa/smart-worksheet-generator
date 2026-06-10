import { describe, it, expect } from 'vitest';
import { getDifficultyProfile, getAllProfiles, buildDifficultyPrompt } from '../difficultyProfiles';
import type { Difficulty } from '../../types';

describe('getDifficultyProfile', () => {
  it('returns a profile for A2', () => {
    const profile = getDifficultyProfile('A2');
    expect(profile.level).toBe('A2');
    expect(profile.label).toContain('Elementary');
    expect(profile.vocabulary.cefrTargetRange).toEqual(['A1', 'A2']);
    expect(profile.vocabulary.maxAboveLevelRatio).toBe(0.1);
    expect(profile.vocabulary.academicWordList).toBe(false);
    expect(profile.sentence.avgSentenceLength).toEqual([8, 14]);
    expect(profile.sentence.maxClauseDepth).toBe(1);
    expect(profile.sentence.passiveVoice).toBe('avoid');
    expect(profile.sentence.allowedConstructions).toEqual(['simple', 'compound']);
    expect(profile.mcQuestions.distractorPlausibility).toBe('obvious');
    expect(profile.mcQuestions.inferenceSteps).toEqual([0, 1]);
    expect(profile.mcQuestions.questionStemComplexity).toBe('simple');
    expect(profile.mcQuestions.paraphraseRequired).toBe(false);
    expect(profile.mcQuestions.negativeQuestions).toBe(false);
    expect(profile.summary.maxBlankWords).toBe(1);
    expect(profile.syntax.sentenceWordRange).toEqual([10, 18]);
    expect(profile.syntax.decompositionDetail).toBe('basic');
    expect(profile.writing.qaComplexity).toBe('recall');
    expect(profile.writing.criticalThinkingType).toBe('personal-response');
  });

  it('returns a profile for B1', () => {
    const profile = getDifficultyProfile('B1');
    expect(profile.level).toBe('B1');
    expect(profile.label).toContain('Intermediate');
    expect(profile.vocabulary.cefrTargetRange).toEqual(['A2', 'B1']);
    expect(profile.sentence.maxClauseDepth).toBe(2);
    expect(profile.sentence.passiveVoice).toBe('limit');
    expect(profile.mcQuestions.distractorPlausibility).toBe('moderate');
    expect(profile.mcQuestions.paraphraseRequired).toBe(true);
    expect(profile.summary.maxBlankWords).toBe(2);
    expect(profile.syntax.sentenceWordRange).toEqual([14, 24]);
    expect(profile.writing.qaComplexity).toBe('explain');
  });

  it('returns a profile for B2', () => {
    const profile = getDifficultyProfile('B2');
    expect(profile.level).toBe('B2');
    expect(profile.vocabulary.cefrTargetRange).toEqual(['B1', 'B2']);
    expect(profile.vocabulary.academicWordList).toBe(true);
    expect(profile.sentence.maxClauseDepth).toBe(3);
    expect(profile.sentence.passiveVoice).toBe('allow');
    expect(profile.sentence.allowedConstructions).toContain('compound-complex');
    expect(profile.mcQuestions.distractorPlausibility).toBe('plausible');
    expect(profile.mcQuestions.inferenceSteps).toEqual([1, 3]);
    expect(profile.mcQuestions.negativeQuestions).toBe(true);
    expect(profile.summary.maxBlankWords).toBe(3);
    expect(profile.syntax.sentenceWordRange).toEqual([20, 36]);
    expect(profile.writing.qaComplexity).toBe('analyze');
    expect(profile.writing.criticalThinkingType).toBe('analysis');
    expect(profile.writing.conjunctionExamples).toContain('whereas');
    expect(profile.writing.conjunctionExamples).toContain('in contrast');
  });

  it('returns a profile for C1', () => {
    const profile = getDifficultyProfile('C1');
    expect(profile.level).toBe('C1');
    expect(profile.vocabulary.cefrTargetRange).toEqual(['B2', 'C1']);
    expect(profile.vocabulary.preferHighFrequencyTopN).toBe(8000);
    expect(profile.sentence.maxClauseDepth).toBe(4);
    expect(profile.sentence.avgSentenceLength).toEqual([20, 34]);
    expect(profile.mcQuestions.distractorPlausibility).toBe('subtle');
    expect(profile.mcQuestions.inferenceSteps).toEqual([2, 5]);
    expect(profile.mcQuestions.questionStemComplexity).toBe('complex');
    expect(profile.syntax.sentenceWordRange).toEqual([26, 50]);
    expect(profile.syntax.decompositionDetail).toBe('detailed');
    expect(profile.syntax.targetClauseTypes).toContain('appositive');
    expect(profile.syntax.targetClauseTypes).toContain('concessive');
    expect(profile.writing.qaComplexity).toBe('evaluate');
    expect(profile.writing.criticalThinkingType).toBe('evaluation');
    expect(profile.writing.conjunctionExamples).toContain('notwithstanding');
    expect(profile.writing.conjunctionExamples).toContain('insofar as');
  });

  it('returns unique profiles for all levels', () => {
    const levels: Difficulty[] = ['A2', 'B1', 'B2', 'C1'];
    const profiles = levels.map(l => getDifficultyProfile(l));

    // Each profile should be distinct
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i].vocabulary.cefrTargetRange).not.toEqual(profiles[i - 1].vocabulary.cefrTargetRange);
      expect(profiles[i].sentence.maxClauseDepth).toBeGreaterThan(profiles[i - 1].sentence.maxClauseDepth);
    }

    // Monotonic increase in complexity
    expect(profiles[0].sentence.avgSentenceLength[1]).toBeLessThan(profiles[1].sentence.avgSentenceLength[1]);
    expect(profiles[1].sentence.avgSentenceLength[1]).toBeLessThan(profiles[2].sentence.avgSentenceLength[1]);
    expect(profiles[2].sentence.avgSentenceLength[1]).toBeLessThan(profiles[3].sentence.avgSentenceLength[1]);
  });
});

describe('getAllProfiles', () => {
  it('returns all four profiles', () => {
    const all = getAllProfiles();
    expect(Object.keys(all)).toHaveLength(4);
    expect(all.A2).toBeDefined();
    expect(all.B1).toBeDefined();
    expect(all.B2).toBeDefined();
    expect(all.C1).toBeDefined();
  });

  it('returns a copy, not the original', () => {
    const a = getAllProfiles();
    const b = getAllProfiles();
    expect(a).not.toBe(b);
  });
});

describe('buildDifficultyPrompt', () => {
  it('produces a non-empty string', () => {
    const profile = getDifficultyProfile('B2');
    const prompt = buildDifficultyPrompt(profile);
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes level label', () => {
    const profile = getDifficultyProfile('A2');
    const prompt = buildDifficultyPrompt(profile);
    expect(prompt).toContain('A2');
    expect(prompt).toContain('Elementary');
  });

  it('includes vocabulary constraints', () => {
    const profile = getDifficultyProfile('B1');
    const prompt = buildDifficultyPrompt(profile);
    expect(prompt).toContain('VOCABULARY CONSTRAINTS');
    expect(prompt).toContain('SENTENCE CONSTRAINTS');
  });

  it('includes section-specific controls', () => {
    const profile = getDifficultyProfile('C1');
    const prompt = buildDifficultyPrompt(profile);
    expect(prompt).toContain('PART 1 — SUMMARY COMPLETION');
    expect(prompt).toContain('PART 2 — MULTIPLE CHOICE');
    expect(prompt).toContain('PART 3 — SYNTAX DECONSTRUCTION');
    expect(prompt).toContain('PART 4 — WRITING & LOGIC WORKSHOP');
  });
});

describe('profile data integrity', () => {
  const levels: Difficulty[] = ['A2', 'B1', 'B2', 'C1'];

  it('every profile has all required sub-profiles', () => {
    for (const level of levels) {
      const p = getDifficultyProfile(level);
      expect(p.vocabulary).toBeDefined();
      expect(p.vocabulary.guidance).toBeTruthy();
      expect(p.sentence).toBeDefined();
      expect(p.sentence.guidance).toBeTruthy();
      expect(p.summary).toBeDefined();
      expect(p.summary.guidance).toBeTruthy();
      expect(p.mcQuestions).toBeDefined();
      expect(p.mcQuestions.guidance).toBeTruthy();
      expect(p.syntax).toBeDefined();
      expect(p.syntax.guidance).toBeTruthy();
      expect(p.writing).toBeDefined();
      expect(p.writing.guidance).toBeTruthy();
    }
  });

  it('conjunction counts increase with level', () => {
    const counts = levels.map(l => getDifficultyProfile(l).writing.conjunctionExamples.length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  it('sentence length ranges increase monotonically', () => {
    const maxes = levels.map(l => getDifficultyProfile(l).sentence.avgSentenceLength[1]);
    for (let i = 1; i < maxes.length; i++) {
      expect(maxes[i]).toBeGreaterThan(maxes[i - 1]);
    }
  });

  it('syntax sentence ranges increase monotonically', () => {
    const maxes = levels.map(l => getDifficultyProfile(l).syntax.sentenceWordRange[1]);
    for (let i = 1; i < maxes.length; i++) {
      expect(maxes[i]).toBeGreaterThan(maxes[i - 1]);
    }
  });
});
