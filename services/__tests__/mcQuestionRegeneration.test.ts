import { describe, expect, it } from 'vitest';
import type { MCQuestion, MCQuestionType, CognitiveLevel } from '../../types';
import {
  buildSingleMCQuestionPrompt,
  isRegeneratedMCQuestionAcceptable,
  applyRegeneratedMCQuestion,
  regenerateMCQuestion,
} from '../aiService';

const SLOTS: Array<[MCQuestionType, CognitiveLevel, NonNullable<MCQuestion['scope']>]> = [
  ['Main Idea', 'synthesis', 'whole-text'],
  ['Literal Comprehension', 'retrieval', 'single-paragraph'],
  ['Inference', 'inference', 'single-paragraph'],
  ['Inference', 'inference', 'cross-paragraph'],
  ['Inference', 'synthesis', 'whole-text'],
  ['Evidence Reasoning', 'inference', 'cross-paragraph'],
  ['Evidence Reasoning', 'inference', 'cross-paragraph'],
  ['Structure / Function / Synthesis', 'synthesis', 'whole-text'],
  ['Vocabulary in Context', 'inference', 'single-paragraph'],
  ['Structure / Function / Synthesis', 'synthesis', 'whole-text'],
];

export function makeB2Questions(): MCQuestion[] {
  return SLOTS.map(([type, cognitiveLevel, scope], index) => {
    const id = `q${index + 1}`;
    return {
      id,
      type,
      cognitiveLevel,
      scope,
      skillTarget: id === 'q8' ? 'author attitude and tone' : `B2 skill ${id}`,
      question: id === 'q8' ? 'Which description best captures the author’s attitude?' : `Question ${id} tests a distinct idea?`,
      options: ['Correct option', 'Distractor one', 'Distractor two', 'Distractor three'],
      answer: 'A',
      explanation: 'Two pieces of evidence support this interpretation.',
      evidence: ['P1', 'P3'],
      reasoningSteps: ['Identify the relevant ideas.', 'Connect them to the supported conclusion.'],
      distractors: {
        B: { pattern: 'Too Broad', rationale: 'Overstates the article.' },
        C: { pattern: 'Wrong Scope', rationale: 'Uses the wrong paragraph.' },
        D: { pattern: 'Unsupported Inference', rationale: 'Lacks textual support.' },
      },
      ...(id === 'q6' || id === 'q7' ? { evidencePairLink: { claimQuestionId: 'q6', evidenceQuestionId: 'q7' } } : {}),
    };
  });
}

describe('buildSingleMCQuestionPrompt', () => {
  it('targets one slot and forbids repeating the current item', () => {
    const questions = makeB2Questions();
    const prompt = buildSingleMCQuestionPrompt('Article text', 'B2', 'q7', questions);
    expect(prompt).toContain('q7');
    expect(prompt).toContain('do not repeat');
    expect(prompt).toContain('Existing stems to avoid');
    expect(prompt).toContain('Linked pair context');
  });
});

describe('isRegeneratedMCQuestionAcceptable', () => {
  it('accepts a fresh, blueprint-compliant replacement', () => {
    const questions = makeB2Questions();
    const candidate = { ...questions[6], question: 'Which quotation best proves the writer’s claim?' };
    expect(isRegeneratedMCQuestionAcceptable(candidate, questions[6], 'B2', questions)).toEqual([]);
  });

  it('rejects a replacement with a duplicated stem', () => {
    const questions = makeB2Questions();
    const candidate = { ...questions[6], question: questions[2].question };
    expect(isRegeneratedMCQuestionAcceptable(candidate, questions[6], 'B2', questions))
      .toContain('duplicates another question stem');
  });

  it('rejects a replacement whose options break length parity', () => {
    const questions = makeB2Questions();
    const candidate = {
      ...questions[6],
      options: ['Correct option', 'A distractor that is clearly much too long', 'Short one', 'Short two'],
    };
    const reasons = isRegeneratedMCQuestionAcceptable(candidate, questions[6], 'B2', questions);
    expect(reasons.some(reason => reason.includes('within 2 words'))).toBe(true);
  });

  it('rejects a replacement that loses the assigned slot metadata', () => {
    const questions = makeB2Questions();
    const candidate = { ...questions[6], type: 'Inference' as MCQuestionType };
    const reasons = isRegeneratedMCQuestionAcceptable(candidate, questions[6], 'B2', questions);
    expect(reasons.some(reason => reason.includes('slot'))).toBe(true);
  });
});

describe('applyRegeneratedMCQuestion', () => {
  it('forces slot metadata and the canonical q6/q7 link', () => {
    const questions = makeB2Questions();
    const candidate = {
      ...questions[6],
      type: 'Inference' as MCQuestionType,
      evidencePairLink: undefined,
      question: 'A fresh evidence question?',
    };
    const next = applyRegeneratedMCQuestion(questions, candidate, 'B2');
    expect(next[6].type).toBe('Evidence Reasoning');
    expect(next[6].evidencePairLink).toEqual({ claimQuestionId: 'q6', evidenceQuestionId: 'q7' });
    expect(next[6].question).toBe('A fresh evidence question?');
    expect(next).toHaveLength(10);
  });
});

describe('regenerateMCQuestion', () => {
  it('retries until the candidate passes', async () => {
    const questions = makeB2Questions();
    const bad = { ...questions[6], id: 'q7', evidence: ['only one'], question: 'A weak replacement?' };
    const good = { ...questions[6], id: 'q7', question: 'Which quotation best proves the writer’s claim?' };
    const calls: string[] = [];
    const fake = async (prompt: string) => {
      calls.push(prompt);
      return { multipleChoice: [calls.length === 1 ? bad : good] };
    };

    const result = await regenerateMCQuestion('Article', 'B2', 'q7', questions, undefined, fake);
    expect(result.question).toBe(good.question);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('RETRY CORRECTION');
  });

  it('throws after three failed attempts without changing the worksheet', async () => {
    const questions = makeB2Questions();
    const fake = async () => ({ multipleChoice: [] });
    await expect(regenerateMCQuestion('Article', 'B2', 'q7', questions, undefined, fake))
      .rejects.toThrow(/Could not regenerate q7/);
  });
});
