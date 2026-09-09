import { describe, expect, it } from 'vitest';
import type { MCQuestion, MCQuestionType, CognitiveLevel } from '../../types';
import { getInvalidB2QuestionIds } from '../aiService';

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
