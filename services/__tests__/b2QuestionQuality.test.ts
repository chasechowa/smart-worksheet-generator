import { describe, expect, it } from 'vitest';
import type { MCQuestion, MCQuestionType, CognitiveLevel } from '../../types';
import { getInvalidB2QuestionIds, getLengthInvalidQuestionIds, getInvalidMCQuestionIds, mergeRegeneratedHalf } from '../aiService';

const slots: Array<[MCQuestionType, CognitiveLevel, NonNullable<MCQuestion['scope']>]> = [
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

function makeValidQuestions(): MCQuestion[] {
  return slots.map(([type, cognitiveLevel, scope], index) => {
    const id = `q${index + 1}`;
    const answer = 'A';
    return {
      id,
      type,
      cognitiveLevel,
      scope,
      skillTarget: id === 'q8' ? 'author attitude and tone' : `B2 skill ${id}`,
      question: id === 'q8' ? 'Which description best captures the author’s attitude?' : `Question ${id} tests a distinct idea?`,
      options: ['Correct option', 'Distractor one', 'Distractor two', 'Distractor three'],
      answer,
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

describe('getInvalidB2QuestionIds', () => {
  it('accepts a complete fixed B2 blueprint', () => {
    expect(getInvalidB2QuestionIds(makeValidQuestions())).toEqual([]);
  });

  it('rejects shallow inference and a missing author-attitude target', () => {
    const questions = makeValidQuestions();
    questions[3].evidence = ['P2'];
    questions[7].skillTarget = 'paragraph structure';
    questions[7].question = 'Why does the author include paragraph four?';
    expect(getInvalidB2QuestionIds(questions)).toEqual(expect.arrayContaining(['q4', 'q8']));
  });

  it('rejects a direct lookup stem outside the retrieval slot', () => {
    const questions = makeValidQuestions();
    questions[2].question = 'According to the article, what happened?';
    expect(getInvalidB2QuestionIds(questions)).toContain('q3');
  });
});

describe('option-length enforcement at generation time', () => {
  const makeLengthViolation = () => {
    const questions = makeValidQuestions();
    // Correct option = 2 words; option B = 8 words.
    questions[2].options = ['Correct option', 'A distractor that is clearly much too long', 'Short one', 'Short two'];
    return questions;
  };

  it('accepts a compliant non-B2 set', () => {
    expect(getInvalidMCQuestionIds(makeValidQuestions(), 'B1')).toEqual([]);
  });

  it('flags a length violation at a non-B2 level without B2 slot checks', () => {
    const questions = makeLengthViolation();
    expect(getLengthInvalidQuestionIds(questions)).toEqual(['q3']);
    expect(getInvalidMCQuestionIds(questions, 'B1')).toEqual(['q3']);
  });

  it('unions B2 hard violations with length violations', () => {
    const questions = makeLengthViolation();
    questions[3].evidence = ['P1']; // q4 hard failure
    expect(getInvalidMCQuestionIds(questions, 'B2')).toEqual(['q3', 'q4']);
  });

  it('leaves the legacy B2 checker length-agnostic', () => {
    expect(getInvalidB2QuestionIds(makeLengthViolation())).toEqual([]);
  });
});

describe('normalized length checking and id-safe merging', () => {
  it('strips option prefixes and tolerates punctuation in the answer', () => {
    const questions = makeValidQuestions();
    questions[2].options = ['A. Correct option', 'B. Short one', 'C. Short two', 'D. Short three'];
    questions[2].answer = 'a.';
    expect(getLengthInvalidQuestionIds(questions)).toEqual([]);
  });

  it('flags a prefixed long distractor after normalization', () => {
    const questions = makeValidQuestions();
    questions[2].options = ['A. Correct option', 'B. This distractor is far too long now', 'C. Short one', 'D. Short two'];
    questions[2].answer = 'A.';
    expect(getLengthInvalidQuestionIds(questions)).toEqual(['q3']);
  });

  it('merges regenerated halves whose ids differ in case or whitespace', () => {
    const previous = makeValidQuestions().slice(0, 5);
    const regenerated = previous.map(question => ({ ...question, id: ` Q${question.id.slice(1)} ` }));
    const merged = mergeRegeneratedHalf(previous, regenerated, 1, 5);
    expect(merged.map(question => question.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
  });

  it('keeps previous questions for ids omitted by a partial retry', () => {
    const previous = makeValidQuestions().slice(0, 5);
    const partial = [{ ...previous[2], id: 'q3', question: 'Regenerated q3?' }];
    const merged = mergeRegeneratedHalf(previous, partial, 1, 5);
    expect(merged.map(question => question.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    expect(merged[2].question).toBe('Regenerated q3?');
    expect(merged[0].question).toBe(previous[0].question);
  });
});
