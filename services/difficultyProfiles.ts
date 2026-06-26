/**
 * Quantitative Difficulty Profiles
 *
 * Each CEFR level maps to measurable constraints for every worksheet section.
 * These profiles drive dynamic prompt assembly instead of hardcoded text.
 */
import type { Difficulty, DifficultyProfile, DifficultyProfiles } from '../types';

// ---------------------------------------------------------------------------
// Profile Definitions
// ---------------------------------------------------------------------------

const PROFILES: DifficultyProfiles = {
  // =========================================================================
  // A2 — Elementary
  // =========================================================================
  A2: {
    level: 'A2',
    label: 'A2 — Elementary',
    learnerDescription:
      'Learner understands very basic sentences and common expressions. Can read short, simple texts with high-frequency vocabulary. Can find specific, predictable information in simple everyday material.',

    vocabulary: {
      cefrTargetRange: ['A1', 'A2'],
      maxAboveLevelRatio: 0.1,
      preferHighFrequencyTopN: 2000,
      academicWordList: false,
      maxLowFrequencyWords: 2,
      guidance:
        'Use ONLY high-frequency A1–A2 vocabulary. At most 10% of content words may be B1 level. ' +
        'No academic or technical vocabulary. No idioms. No phrasal verbs with non-literal meanings. ' +
        'Prefer words from the top 2000 most frequent English word families.',
    },

    sentence: {
      avgSentenceLength: [8, 14],
      maxClauseDepth: 1,
      allowedConstructions: ['simple', 'compound'],
      passiveVoice: 'avoid',
      readabilityGrade: [2, 4],
      guidance:
        'Sentences must average 8–14 words. Use ONLY simple and compound constructions ' +
        '(subject-verb, subject-verb + and/but/or + subject-verb). No subordinating conjunctions ' +
        '(before, after, because, if, when, although) except in the syntax section. ' +
        'NO passive voice. Each sentence should express one clear idea.',
    },

    summary: {
      maxBlankWords: 1,
      paraphraseDegree: 'verbatim-phrases',
      guidance:
        'Each blank must be exactly 1 word — a single high-frequency noun, verb, or adjective directly copied from the article. ' +
        'The summary paragraph must be short (4–6 sentences) using only simple sentence structures. ' +
        'Blanks should test basic comprehension of key facts only.',
    },

    mcQuestions: {
      distractorPlausibility: 'obvious',
      inferenceSteps: [0, 1],
      questionStemComplexity: 'simple',
      paraphraseRequired: false,
      negativeQuestions: false,
      cognitiveRatios: { retrieval: 0.70, inference: 0.25, synthesis: 0.05 },
      maxRetrievalQuestions: 7,
      minInferenceQuestions: 1,
      minSynthesisQuestions: 0,
      guidance:
        'Questions test LITERAL COMPREHENSION only — the answer is stated directly in the text. ' +
        'Distractors must be OBVIOUSLY wrong (contradict the text, mention things not in the text, or wildly misinterpret). ' +
        'Question stems use the simplest structure: "What is X?", "Where does Y happen?", "Who does Z?". ' +
        'No inference. No "EXCEPT" or "NOT" questions. No paraphrasing required — answer phrases match the text exactly. ' +
        'Main Idea questions can ask "What is the passage about?" with a very clear correct answer.',
    },

    syntax: {
      sentenceWordRange: [10, 18],
      targetClauseTypes: ['coordinate'],
      decompositionDetail: 'basic',
      guidance:
        'Select 2 relatively short sentences (10–18 words) with clear grammatical structure. ' +
        'Prioritize sentences with coordinating conjunctions (and, but, or) joining two simple clauses. ' +
        'The model decomposition should split at the conjunction into 2 simple sentences. ' +
        'No relative clauses, no adverbial clauses, no subordination.',
    },

    writing: {
      expansionOutput: 'one short sentence using the conjunction',
      conjunctionCategories: ['additive', 'adversative'],
      conjunctionExamples: ['and', 'but', 'or', 'so'],
      qaComplexity: 'recall',
      criticalThinkingType: 'personal-response',
      expectedWritingOutput: '2–3 short sentences',
      guidance:
        'Expansion: use ONLY basic conjunctions (and, but, or, so). Model expanded sentence should be a single simple compound sentence. ' +
        'Keywords: 5 single high-frequency words directly from the article. ' +
        'Q&A: factual recall questions only — answers are found directly in the text. ' +
        'Critical Thinking: simple personal-response prompt (e.g., "Do you agree? Why or why not?").',
    },
  },

  // =========================================================================
  // B1 — Intermediate
  // =========================================================================
  B1: {
    level: 'B1',
    label: 'B1 — Intermediate',
    learnerDescription:
      'Learner can understand the main points of clear standard input on familiar matters. Can read straightforward factual texts with satisfactory comprehension. Can deal with most situations likely to arise while travelling in an English-speaking area.',

    vocabulary: {
      cefrTargetRange: ['A2', 'B1'],
      maxAboveLevelRatio: 0.15,
      preferHighFrequencyTopN: 3000,
      academicWordList: false,
      maxLowFrequencyWords: 4,
      guidance:
        'Use mostly A2–B1 vocabulary. Up to 15% of content words may be B2 level. ' +
        'No academic or highly specialized vocabulary. Simple phrasal verbs are acceptable (give up, find out, look after). ' +
        'Avoid idioms. Prefer words from the top 3000 most frequent English word families.',
    },

    sentence: {
      avgSentenceLength: [12, 18],
      maxClauseDepth: 2,
      allowedConstructions: ['simple', 'compound', 'complex'],
      passiveVoice: 'limit',
      readabilityGrade: [4, 7],
      guidance:
        'Sentences average 12–18 words. Simple, compound, and basic complex constructions allowed. ' +
        'Complex sentences may use ONE subordinating conjunction (because, if, when, although, while). ' +
        'Maximum one level of clause embedding. Passive voice allowed in up to 1 sentence per paragraph. ' +
        'Limit prepositional phrase chains to 2.',
    },

    summary: {
      maxBlankWords: 2,
      paraphraseDegree: 'light-paraphrase',
      guidance:
        'Each blank is 1–2 words — a high-frequency phrase from the article. ' +
        'The summary paragraph should be 5–7 sentences with simple and occasional compound sentences. ' +
        'Blanks test comprehension of key facts and simple relationships. ' +
        'The summary may lightly rephrase the article\'s wording while keeping blanks as verbatim extracts.',
    },

    mcQuestions: {
      distractorPlausibility: 'moderate',
      inferenceSteps: [0, 2],
      questionStemComplexity: 'moderate',
      paraphraseRequired: true,
      negativeQuestions: false,
      cognitiveRatios: { retrieval: 0.50, inference: 0.40, synthesis: 0.10 },
      maxRetrievalQuestions: 5,
      minInferenceQuestions: 3,
      minSynthesisQuestions: 1,
      guidance:
        'Questions test BASIC COMPREHENSION with some simple inference (e.g., understanding cause and effect, identifying author purpose from explicit statements). ' +
        'Distractors should be MODERATELY PLAUSIBLE — wrong answers could be true in a different context or misinterpret one aspect of the text. ' +
        'Up to 4 questions may require 1-step inference. The other 6 should test literal comprehension. ' +
        'Paraphrasing is used in question stems and options to avoid direct text matching. Still no "EXCEPT"/"NOT" questions. ' +
        'Finding Evidence questions should point to explicitly stated facts. ' +
        'Vocabulary in Context should test B1-level words with clear context clues.',
    },

    syntax: {
      sentenceWordRange: [14, 24],
      targetClauseTypes: ['coordinate', 'relative', 'adverbial'],
      decompositionDetail: 'basic',
      guidance:
        'Select 2 medium-length sentences (14–24 words) with at least one subordinate clause each. ' +
        'Prioritize sentences containing relative clauses (who, which, that) or adverbial clauses (because, when, if). ' +
        'Model decomposition should break into 2–3 simple clauses with clause-type labels. No deeply nested structures.',
    },

    writing: {
      expansionOutput: 'one compound or simple complex sentence',
      conjunctionCategories: ['additive', 'adversative', 'causal'],
      conjunctionExamples: ['and', 'but', 'or', 'so', 'because', 'however', 'therefore', 'although'],
      qaComplexity: 'explain',
      criticalThinkingType: 'personal-response',
      expectedWritingOutput: '1 short paragraph (3–5 sentences)',
      guidance:
        'Expansion: use common conjunctions (and, but, or, so, because, however, therefore, although). Model sentence may combine 2–3 clauses. ' +
        'Keywords: 5 words or short 2-word phrases directly from the article. ' +
        'Q&A: simple explanation questions — "Explain why X happens" or "Describe how Y works" based on text. ' +
        'Critical Thinking: personal opinion prompt asking learners to relate the topic to their own experience.',
    },
  },

  // =========================================================================
  // B2 — Upper Intermediate
  // =========================================================================
  B2: {
    level: 'B2',
    label: 'B2 — Upper Intermediate',
    learnerDescription:
      'Learner can understand the main ideas of complex text on both concrete and abstract topics. Can read articles and reports concerned with contemporary problems in which the writers adopt particular attitudes or viewpoints. Can interact with a degree of fluency and spontaneity.',

    vocabulary: {
      cefrTargetRange: ['B1', 'B2'],
      maxAboveLevelRatio: 0.1,
      preferHighFrequencyTopN: 5000,
      academicWordList: true,
      maxLowFrequencyWords: 6,
      guidance:
        'Use B1–B2 vocabulary as the base. Up to 10% C1-level academic or topic-specific vocabulary is acceptable. ' +
        'Academic Word List (AWL) vocabulary is appropriate and encouraged. ' +
        'Phrasal verbs, some common idioms, and collocations are acceptable. ' +
        'Vocabulary in Context questions should test B2-level polysemous words or academic vocabulary.',
    },

    sentence: {
      avgSentenceLength: [16, 26],
      maxClauseDepth: 3,
      allowedConstructions: ['simple', 'compound', 'complex', 'compound-complex'],
      passiveVoice: 'allow',
      readabilityGrade: [7, 10],
      guidance:
        'Sentences average 16–26 words. All construction types allowed, including compound-complex. ' +
        'Multiple clauses may be embedded (max depth 3). Passive voice is acceptable. ' +
        'Prepositional phrase chains up to 3 are fine. Sentences may express nuanced relationships ' +
        '(cause/effect, contrast, condition, concession).',
    },

    summary: {
      maxBlankWords: 3,
      paraphraseDegree: 'moderate-paraphrase',
      guidance:
        'Each blank is 1–3 words — exact verbatim phrases from the article. ' +
        'The summary should be a coherent 6–9 sentence paragraph using a mix of sentence types. ' +
        'Blanks test comprehension of main ideas, supporting details, and logical relationships. ' +
        'The summary should paraphrase the article\'s structure while keeping blank answers as verbatim extracts.',
    },

    mcQuestions: {
      distractorPlausibility: 'plausible',
      inferenceSteps: [1, 3],
      questionStemComplexity: 'moderate',
      paraphraseRequired: true,
      negativeQuestions: true,
      cognitiveRatios: { retrieval: 0.20, inference: 0.50, synthesis: 0.30 },
      maxRetrievalQuestions: 2,
      minInferenceQuestions: 5,
      minSynthesisQuestions: 3,
      guidance:
        'Questions test INFERENTIAL COMPREHENSION — most answers require reading between the lines. ' +
        'Cognitive targets: ~20% retrieval, ~50% inference, ~30% synthesis/evaluation. ' +
        'Max 2 questions may be answered by single-sentence retrieval. At least 3 questions require combining info across paragraphs. ' +
        'Distractors must be HIGHLY PLAUSIBLE based on common student misconceptions: ' +
        'true statement but wrong paragraph, too broad, too narrow, tempting but incorrect inference. ' +
        '"EXCEPT" and "NOT" questions are acceptable (1–2 max). ' +
        'Evidence Reasoning questions MUST form a linked pair (claim + supporting evidence). ' +
        'Main Idea questions should require synthesis across paragraphs.',
    },

    syntax: {
      sentenceWordRange: [20, 36],
      targetClauseTypes: ['coordinate', 'relative', 'adverbial', 'nominal', 'participial'],
      decompositionDetail: 'moderate',
      guidance:
        'Select 2 grammatically complex sentences (20–36 words) with greatest learning value. ' +
        'Prioritize: relative clauses (who, which, that, whose), adverbial clauses (while, although, whereas), ' +
        'nominal clauses (that-clauses, wh-clauses), and participial phrases. ' +
        'Target sentences with 2–3 layers of clause embedding. Do NOT select a sentence just because it is long. ' +
        'Model decomposition should break into 3–5 simple clauses with labeled clause types.',
    },

    writing: {
      expansionOutput: 'one multi-clause complex sentence',
      conjunctionCategories: ['additive', 'adversative', 'causal', 'temporal', 'conditional'],
      conjunctionExamples: [
        'however', 'therefore', 'moreover', 'consequently', 'although', 'despite',
        'whereas', 'while', 'provided that', 'unless', 'as a result', 'in contrast',
      ],
      qaComplexity: 'analyze',
      criticalThinkingType: 'analysis',
      expectedWritingOutput: '1–2 well-developed paragraphs',
      guidance:
        'Expansion: use a variety of logical connectors (contrast, cause-effect, concession, condition). ' +
        'Model sentence should combine 3+ clauses into a coherent complex sentence. ' +
        'Keywords: 5 key terms from the article (can be 2–3 word phrases) representing core concepts. ' +
        'Q&A: analytical questions requiring synthesis — "Analyze the relationship between...", "How does X contribute to Y?". ' +
        'Critical Thinking: argument analysis prompt evaluating claims, evidence, or rhetorical strategies in the article.',
    },
  },

  // =========================================================================
  // C1 — Advanced
  // =========================================================================
  C1: {
    level: 'C1',
    label: 'C1 — Advanced',
    learnerDescription:
      'Learner can understand a wide range of demanding, longer texts, and recognize implicit meaning. Can read with ease virtually all forms of the written language, including abstract, structurally or linguistically complex texts such as manuals, specialised articles and literary works. Can express ideas fluently and spontaneously.',

    vocabulary: {
      cefrTargetRange: ['B2', 'C1'],
      maxAboveLevelRatio: 0.15,
      preferHighFrequencyTopN: 8000,
      academicWordList: true,
      maxLowFrequencyWords: 10,
      guidance:
        'Use B2–C1 vocabulary. Up to 15% may be C2 or low-frequency academic/technical terms. ' +
        'Academic Word List vocabulary should be used naturally. Idioms, colloquialisms, and nuanced word choices are appropriate. ' +
        'Vocabulary in Context should test C1-level nuanced vocabulary with subtle context clues. ' +
        'Words with multiple meanings or domain-specific usage are encouraged.',
    },

    sentence: {
      avgSentenceLength: [20, 34],
      maxClauseDepth: 4,
      allowedConstructions: ['simple', 'compound', 'complex', 'compound-complex'],
      passiveVoice: 'allow',
      readabilityGrade: [10, 14],
      guidance:
        'Sentences average 20–34 words. All construction types — compound-complex is standard. ' +
        'Multiple embedded clauses (max depth 4). Passive voice, inversion, cleft sentences, and other advanced structures are encouraged. ' +
        'Sentences should express sophisticated logical relationships and nuanced argumentation. ' +
        'Prepositional phrase chains and nested modification are acceptable.',
    },

    summary: {
      maxBlankWords: 3,
      paraphraseDegree: 'moderate-paraphrase',
      guidance:
        'Each blank is 1–3 words — exact verbatim phrases from the article. ' +
        'The summary should be a sophisticated 7–10 sentence paragraph demonstrating advanced synthesis. ' +
        'Blanks test comprehension of nuanced ideas, implicit relationships, and abstract concepts. ' +
        'The summary should restructure the article\'s argument while keeping blank answers as precise verbatim extracts.',
    },

    mcQuestions: {
      distractorPlausibility: 'subtle',
      inferenceSteps: [2, 5],
      questionStemComplexity: 'complex',
      paraphraseRequired: true,
      negativeQuestions: true,
      cognitiveRatios: { retrieval: 0.10, inference: 0.40, synthesis: 0.50 },
      maxRetrievalQuestions: 1,
      minInferenceQuestions: 4,
      minSynthesisQuestions: 5,
      minInferenceSteps: 3,
      counterfactualRequired: true,
      vocabLevel: 'C1-C2 academic',
      paraphraseStrict: true,
      guidance:
        'C1 ADVANCED LEVEL — questions must feel like IELTS 8.0+ / TOEFL 28+ / SAT 700+ difficulty. ' +
        'Distractors must be INDISTINGUISHABLE from correct answer on first read — only close re-reading reveals the flaw. ' +
        'Every Inference question requires 3–5 reasoning steps across paragraphs. ' +
        'Vocabulary options: ALL 4 must be C1/C2 academic words (e.g., "recrudescence" not "return"). ' +
        'Correct answers NEVER reuse passage wording — strict paraphrase gate enforced. ' +
        'At least 1 question requires COUNTERFACTUAL reasoning. ' +
        'Structure/Function must analyze rhetorical STRATEGY, not just purpose. ' +
        'Evidence pairs: evidence must DIRECTLY prove the claim, not just be topic-adjacent. ' +
        'Question stems use complex academic phrasing with embedded clauses.',
    },

    syntax: {
      sentenceWordRange: [26, 50],
      targetClauseTypes: [
        'coordinate', 'relative', 'adverbial', 'nominal', 'participial',
        'appositive', 'conditional', 'concessive', 'inversion', 'reduced',
      ],
      decompositionDetail: 'detailed',
      guidance:
        'Select 2 grammatically sophisticated sentences (26–50 words) with greatest learning value. ' +
        'Prioritize: inversion, reduced clauses, appositive phrases, counterfactual conditionals, ' +
        'concessive clauses, nominalizations, and 3–4 layers of complex embedding. ' +
        'Do NOT select a sentence merely because it is long — it must demonstrate advanced grammatical patterns. ' +
        'Model decomposition should break into 4–7 simple clauses with labeled clause types and grammatical functions.',
    },

    writing: {
      expansionOutput: 'a sophisticated multi-clause sentence with nuanced logical relationships',
      conjunctionCategories: ['additive', 'adversative', 'causal', 'temporal', 'conditional'],
      conjunctionExamples: [
        'however', 'therefore', 'moreover', 'consequently', 'nevertheless', 'nonetheless',
        'accordingly', 'conversely', 'whereas', 'whilst', 'albeit', 'notwithstanding',
        'insofar as', 'by virtue of', 'in light of', 'on the grounds that',
      ],
      qaComplexity: 'evaluate',
      criticalThinkingType: 'evaluation',
      expectedWritingOutput: '2–3 well-developed paragraphs',
      guidance:
        'Expansion: use a wide range of logical connectors including concessive and conditional markers. ' +
        'Model sentence should demonstrate sophisticated subordination and precise logical relationships. ' +
        'Keywords: 5 key academic or domain-specific terms (can be 2–4 word phrases) critical to the article\'s argument. ' +
        'Q&A: evaluative questions — "Evaluate the author\'s claim that...", "To what extent does the evidence support...". ' +
        'Critical Thinking: evaluative/argumentative prompt requiring assessment of claims, evidence quality, counterarguments, ' +
        'and implications. May ask learners to critique the author\'s reasoning or propose alternative interpretations.',
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the quantitative difficulty profile for a CEFR level. */
export function getDifficultyProfile(level: Difficulty): DifficultyProfile {
  return PROFILES[level];
}

/** Get all difficulty profiles. */
export function getAllProfiles(): DifficultyProfiles {
  return { ...PROFILES };
}

/**
 * Build the difficulty section of a generation prompt.
 * Translates the profile into actionable AI instructions.
 */
export function buildDifficultyPrompt(profile: DifficultyProfile): string {
  return `
═══════════════════════════════════════════════════════════════
TARGET LEVEL: ${profile.label}
Learner: ${profile.learnerDescription}
═══════════════════════════════════════════════════════════════

VOCABULARY CONSTRAINTS:
${profile.vocabulary.guidance}

SENTENCE CONSTRAINTS:
${profile.sentence.guidance}

═══════════════════════════════════════════════════════════════
SECTION-SPECIFIC DIFFICULTY CONTROLS:

PART 1 — SUMMARY COMPLETION:
${profile.summary.guidance}

PART 2 — MULTIPLE CHOICE:
${profile.mcQuestions.guidance}

PART 3 — SYNTAX DECONSTRUCTION:
${profile.syntax.guidance}

PART 4 — WRITING & LOGIC WORKSHOP:
${profile.writing.guidance}
`;
}
