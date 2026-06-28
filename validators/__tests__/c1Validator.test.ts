import { describe, it, expect } from 'vitest';
import { validateC1Boundaries } from '../c1Validator';
import type { MCQuestion } from '../../types';

function makeQ(overrides: Partial<MCQuestion> = {}): MCQuestion {
  return {
    id: 'q1',
    type: 'Inference',
    cognitiveLevel: 'inference',
    question: 'What can be inferred about the author\'s position on renewable energy?',
    options: ['She supports it with reservations', 'She opposes it entirely', 'She is indifferent', 'She advocates for nuclear instead'],
    answer: 'A',
    explanation: 'The author acknowledges benefits while noting challenges.',
    evidence: ['P1S2', 'P2S4'],
    reasoningSteps: ['The author notes cost reductions in paragraph 1.', 'However, she also highlights intermittency challenges in paragraph 2.', 'These two points together suggest qualified support.'],
    distractors: {
      B: { pattern: 'Reversed Logic', rationale: 'The author explicitly supports renewable energy with qualifications, not outright opposition.' },
      C: { pattern: 'Reversed Logic', rationale: 'The author engages deeply with the topic, showing clear interest, not indifference.' },
      D: { pattern: 'Unsupported Inference', rationale: 'The passage does not compare renewable energy to nuclear power.' },
    },
    evidencePairLink: undefined,
    ...overrides,
  };
}

const articleText = 'The author notes that renewable energy costs have decreased significantly. However, she also highlights intermittency challenges in grid integration. These two points together suggest qualified support for continued investment.';

describe('validateC1Boundaries', () => {
  // ── Rule 1: Weak stem openers ──
  it('rejects stems starting with "According to the passage"', () => {
    const q = makeQ({ question: 'According to the passage, what causes climate change?' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('weak stem opener'))).toBe(true);
  });

  it('rejects stems starting with "What role does"', () => {
    const q = makeQ({ question: 'What role does the navigator play in adventure racing?' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('weak stem opener'))).toBe(true);
  });

  it('rejects stems starting with "When did"', () => {
    const q = makeQ({ question: 'When did the treaty take effect?' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('weak stem opener'))).toBe(true);
  });

  it('rejects stems starting with "Which of the following is true"', () => {
    const q = makeQ({ question: 'Which of the following is true about the passage?' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('weak stem opener'))).toBe(true);
  });

  it('rejects "In paragraph X, the word..." pattern', () => {
    const q = makeQ({ type: 'Vocabulary in Context', question: 'In paragraph 3, the word "steady" most nearly means...' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('weak stem opener'))).toBe(true);
  });

  it('accepts analytical stems', () => {
    const q = makeQ({ question: 'How does the passage redefine endurance beyond physical stamina?' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('weak stem opener'))).toBe(false);
  });

  // ── Rule 2: Max 1 literal question ──
  it('rejects more than 1 literal comprehension question', () => {
    const qs = [
      makeQ({ id: 'q1', type: 'Literal Comprehension', question: 'What does the author state about costs?' }),
      makeQ({ id: 'q2', type: 'Literal Comprehension', question: 'What intermittency challenge is mentioned?' }),
    ];
    const issues = validateC1Boundaries(qs, articleText);
    expect(issues.some(i => i.message.includes('Too many literal comprehension'))).toBe(true);
  });

  it('accepts 0-1 literal questions', () => {
    const qs = [makeQ({ id: 'q1', type: 'Literal Comprehension', question: 'What does the author state?' })];
    const issues = validateC1Boundaries(qs, articleText);
    expect(issues.some(i => i.message.includes('Too many literal'))).toBe(false);
  });

  // ── Rule 3: Inference needs ≥2 evidence sentence IDs ──
  it('warns when inference has only 1 evidence sentence', () => {
    const q = makeQ({ evidence: ['P1S1'] });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('only 1 evidence reference'))).toBe(true);
  });

  it('passes inference with ≥2 evidence sentences', () => {
    const q = makeQ({ evidence: ['P1S1', 'P2S1'] });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.filter(i => i.message.includes('evidence reference')).length).toBe(0);
  });

  // ── Rule 4: Inference needs ≥2 reasoningSteps ──
  it('warns when inference has fewer than 2 reasoning steps', () => {
    const q = makeQ({ reasoningSteps: ['The author supports renewables.'] });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('only 1 reasoning step'))).toBe(true);
  });

  it('passes inference with ≥2 reasoning steps', () => {
    const q = makeQ({
      reasoningSteps: ['Step 1: costs decreased.', 'Step 2: intermittency remains.', 'Step 3: qualified support.'],
    });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.filter(i => i.message.includes('reasoning step')).length).toBe(0);
  });

  // ── Rule 5: Vocabulary must not target banned words ──
  it('rejects vocabulary question targeting "steady"', () => {
    const q = makeQ({ id: 'qv', type: 'Vocabulary in Context', question: 'As used in the passage, the word "steady" is closest in meaning to...' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('too low-level for C1'))).toBe(true);
  });

  it('rejects vocabulary question targeting "popular"', () => {
    const q = makeQ({ id: 'qv', type: 'Vocabulary in Context', question: 'As used in the passage, "popular" most nearly means...' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('too low-level for C1'))).toBe(true);
  });

  it('rejects vocabulary question targeting "difficult"', () => {
    const q = makeQ({ id: 'qv', type: 'Vocabulary in Context', question: 'The term "difficult" as used by the author is closest in meaning to...' });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('too low-level for C1'))).toBe(true);
  });

  it('accepts vocabulary question with academic word', () => {
    const q = makeQ({
      id: 'qv', type: 'Vocabulary in Context',
      question: 'In context, "recrudescence" most nearly means...',
      options: ['resurgence', 'decline', 'stagnation', 'concealment'],
    });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('too low-level for C1'))).toBe(false);
  });

  // ── Rule 6: Evidence Reasoning must have linkedQuestionId ──
  it('rejects evidence reasoning without evidencePairLink', () => {
    const q = makeQ({ id: 'q4', type: 'Evidence Reasoning', evidencePairLink: undefined });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('missing evidencePairLink'))).toBe(true);
  });

  it('accepts evidence reasoning with evidencePairLink', () => {
    const q = makeQ({
      id: 'q4', type: 'Evidence Reasoning',
      evidencePairLink: { claimQuestionId: 'q4', evidenceQuestionId: 'q5' },
    });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('missing evidencePairLink'))).toBe(false);
  });

  // ── Rule 7: Correct answer must not copy ≥6 consecutive words ──
  it('rejects correct answer that copies passage verbatim', () => {
    // Use a passage where the phrase is clearly 7+ consecutive words without punctuation interference
    const text = 'Climate change poses serious risks to coastal communities worldwide due to rising sea levels.';
    const q = makeQ({
      type: 'Literal Comprehension',
      question: 'What does the author state about climate change?',
      options: [
        'It is a minor concern',
        'serious risks to coastal communities worldwide',  // 7 words copied from passage
        'It has no impact',
        'It only affects inland areas',
      ],
      answer: 'B',
    });
    const issues = validateC1Boundaries([q], text);
    expect(issues.some(i => i.message.includes('copies'))).toBe(true);
  });

  it('accepts paraphrased correct answer', () => {
    const q = makeQ({
      type: 'Inference',
      question: 'What does the author imply?',
      options: [
        'The financial viability of clean power has improved, though operational hurdles persist',
        'Renewable energy costs have decreased significantly',
        'Grid integration is impossible',
        'Investment is unwarranted',
      ],
      answer: 'A',
    });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('copies'))).toBe(false);
  });

  // ── Rule 8: Distractors must have pattern + rationale ──
  it('warns when distractor has insufficient rationale', () => {
    const q = makeQ({
      distractors: {
        B: { pattern: 'Too Broad', rationale: 'short' }, // < 10 chars
        C: { pattern: 'Reversed Logic', rationale: 'The text says the opposite of this claim, which is clearly contradicted.' },
        D: { pattern: 'Unsupported Inference', rationale: 'No evidence in the passage supports this interpretation of the data presented.' },
      },
    });
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.some(i => i.message.includes('insufficient trap analysis'))).toBe(true);
  });

  it('accepts fully annotated distractors', () => {
    const q = makeQ(); // default has full annotations
    const issues = validateC1Boundaries([q], articleText);
    expect(issues.filter(i => i.message.includes('insufficient trap analysis')).length).toBe(0);
  });
});
