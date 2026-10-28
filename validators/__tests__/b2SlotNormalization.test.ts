import { describe, expect, it } from 'vitest';
import type { WorksheetData, MCQuestion, MCQuestionType, CognitiveLevel } from '../../types';
import { validateMC } from '../mcValidator';
import { getInvalidB2QuestionIds } from '../../services/aiService';

const B2_SLOTS: Array<[MCQuestionType, CognitiveLevel, NonNullable<MCQuestion['scope']>]> = [
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

function makeB2Questions(): MCQuestion[] {
  return B2_SLOTS.map(([type, cognitiveLevel, scope], index) => {
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

function createData(questions: MCQuestion[]): WorksheetData {
  return {
    title: 'Test',
    articleSnippet: 'snippet',
    summary: { paragraph: '', blanks: [] },
    multipleChoice: questions,
    syntaxDeconstruction: [],
    writingWorkshop: { expansion: [], keywords: [], qaChain: [], criticalThinking: '' },
    keys: { summary: [], mc: {}, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
  };
}

describe('B2 skill slot metadata', () => {
  it('does not fail when the model capitalizes cognitiveLevel values', () => {
    // Reproduces the production dialog: q6/q7 "Inference", q10 "Synthesis".
    const questions = makeB2Questions();
    questions[5].cognitiveLevel = 'Inference' as CognitiveLevel;
    questions[6].cognitiveLevel = 'Inference' as CognitiveLevel;
    questions[9].cognitiveLevel = 'Synthesis' as CognitiveLevel;

    const { issues } = validateMC(createData(questions), 'B2');
    const errors = issues.filter(issue => issue.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('canonicalizes spacing and casing differences instead of rejecting them', () => {
    const questions = makeB2Questions();
    questions[5].type = 'evidence reasoning' as MCQuestionType;
    questions[9].type = 'Structure/Function/Synthesis' as MCQuestionType;
    questions[9].scope = 'Whole Text' as NonNullable<MCQuestion['scope']>;

    const { issues, fixedData } = validateMC(createData(questions), 'B2');
    const errors = issues.filter(issue => issue.severity === 'error');
    expect(errors).toEqual([]);
    expect(fixedData.multipleChoice[5].type).toBe('Evidence Reasoning');
    expect(fixedData.multipleChoice[9].type).toBe('Structure / Function / Synthesis');
    expect(fixedData.multipleChoice[9].scope).toBe('whole-text');
  });

  it('auto-aligns a genuine slot mismatch with a warning instead of blocking generation', () => {
    const questions = makeB2Questions();
    questions[0].cognitiveLevel = 'retrieval';

    const { issues, fixedData } = validateMC(createData(questions), 'B2');
    expect(issues.filter(issue => issue.severity === 'error')).toEqual([]);
    expect(fixedData.multipleChoice[0].cognitiveLevel).toBe('synthesis');
    expect(
      issues.some(issue => issue.severity === 'warning' && /skill.slot/i.test(issue.message)),
    ).toBe(true);
  });

  it('keeps generation-time slot detection tolerant of the same variants', () => {
    const questions = makeB2Questions();
    questions[5].cognitiveLevel = 'Inference' as CognitiveLevel;
    questions[9].type = 'structure / function / synthesis' as MCQuestionType;
    expect(getInvalidB2QuestionIds(questions)).toEqual([]);
  });
});
