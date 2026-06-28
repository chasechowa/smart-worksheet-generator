
export type Difficulty = 'A2' | 'B1' | 'B2' | 'C1';

// ---------------------------------------------------------------------------
// Quantitative Difficulty Profiles
// ---------------------------------------------------------------------------

export interface VocabularyProfile {
  /** CEFR word-frequency bands allowed (e.g. ['A1','A2'] for A2 level) */
  cefrTargetRange: [string, string];
  /** Maximum percentage of words allowed above the target CEFR range (0.0–1.0) */
  maxAboveLevelRatio: number;
  /** Prefer high-frequency words from the top N thousand word families */
  preferHighFrequencyTopN: number;
  /** Whether Academic Word List vocabulary is appropriate */
  academicWordList: boolean;
  /** Maximum number of words below 3k frequency rank */
  maxLowFrequencyWords: number;
  /** Human-readable guidance for the AI */
  guidance: string;
}

export interface SentenceProfile {
  /** Target average words per sentence [min, max] */
  avgSentenceLength: [number, number];
  /** Maximum nested clause depth */
  maxClauseDepth: number;
  /** Allowed sentence constructions */
  allowedConstructions: ('simple' | 'compound' | 'complex' | 'compound-complex')[];
  /** Passive voice policy */
  passiveVoice: 'avoid' | 'limit' | 'allow';
  /** Target readability (Flesch-Kincaid grade equivalent) */
  readabilityGrade: [number, number];
  /** Human-readable guidance */
  guidance: string;
}

export interface MCQuestionProfile {
  /** How close distractors are to the correct answer */
  distractorPlausibility: 'obvious' | 'moderate' | 'plausible' | 'subtle';
  /** How many logical steps from text evidence to answer [min, max] */
  inferenceSteps: [number, number];
  /** Complexity of question stems */
  questionStemComplexity: 'simple' | 'moderate' | 'complex';
  /** Whether answering requires paraphrasing the text */
  paraphraseRequired: boolean;
  /** Whether "except/not" negative questions are used */
  negativeQuestions: boolean;
  /** Cognitive depth distribution ratios (must sum to ~1.0) */
  cognitiveRatios: {
    retrieval: number;   // direct sentence-level recall
    inference: number;   // combining info, implications
    synthesis: number;   // transfer, evaluation
  };
  /** Max direct-retrieval questions */
  maxRetrievalQuestions: number;
  /** Min inference questions */
  minInferenceQuestions: number;
  /** Min synthesis/transfer questions */
  minSynthesisQuestions: number;
  /** Min inference steps for C1+ (forces multi-hop reasoning) */
  minInferenceSteps?: number;
  /** Whether counterfactual reasoning is required */
  counterfactualRequired?: boolean;
  /** Target vocabulary level for Vocab-in-Context */
  vocabLevel?: string;
  /** Whether strict paraphrase gate applies (correct answer MUST differ from passage) */
  paraphraseStrict?: boolean;
  /** Human-readable guidance for distractor design */
  guidance: string;
}

export interface SummaryProfile {
  /** Maximum words per blank */
  maxBlankWords: number;
  /** How much the summary paragraph should differ from original wording */
  paraphraseDegree: 'verbatim-phrases' | 'light-paraphrase' | 'moderate-paraphrase';
  /** Human-readable guidance */
  guidance: string;
}

export interface SyntaxProfile {
  /** Target word count range for selected sentences [min, max] */
  sentenceWordRange: [number, number];
  /** Clause types to target for decomposition */
  targetClauseTypes: string[];
  /** How detailed the model decomposition should be */
  decompositionDetail: 'basic' | 'moderate' | 'detailed';
  /** Human-readable guidance */
  guidance: string;
}

export interface WritingProfile {
  /** Expected expansion output description */
  expansionOutput: string;
  /** Allowed conjunction categories */
  conjunctionCategories: ('additive' | 'adversative' | 'causal' | 'temporal' | 'conditional')[];
  /** Conjunction examples suitable for this level */
  conjunctionExamples: string[];
  /** Complexity of Q&A chain questions */
  qaComplexity: 'recall' | 'explain' | 'analyze' | 'evaluate';
  /** Type of critical thinking prompt */
  criticalThinkingType: 'personal-response' | 'analysis' | 'evaluation' | 'synthesis';
  /** Expected writing output length */
  expectedWritingOutput: string;
  /** Human-readable guidance */
  guidance: string;
}

export interface DifficultyProfile {
  level: Difficulty;
  /** Human-readable label (e.g. "B2 — Upper Intermediate") */
  label: string;
  /** One-paragraph description of the target learner */
  learnerDescription: string;
  vocabulary: VocabularyProfile;
  sentence: SentenceProfile;
  summary: SummaryProfile;
  mcQuestions: MCQuestionProfile;
  syntax: SyntaxProfile;
  writing: WritingProfile;
}

export type DifficultyProfiles = Record<Difficulty, DifficultyProfile>;

export type AIProvider = 'gemini' | 'deepseek' | 'kimi' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
}

export interface ProviderConfigs {
  activeProvider: AIProvider;
  providers: Record<AIProvider, AIConfig>;
}

export interface SummaryBlank {
  textBefore: string;
  answer: string;
}

// ── MC Question Types ────────────────────────────────────────────────────

export type MCQuestionType =
  | 'Main Idea'
  | 'Literal Comprehension'
  | 'Inference'
  | 'Evidence Reasoning'
  | 'Vocabulary in Context'
  | 'Structure / Function / Synthesis';

/** Cognitive depth required to answer */
export type CognitiveLevel = 'retrieval' | 'inference' | 'synthesis';

export type DistractorPattern =
  | 'Too Broad'
  | 'Too Narrow'
  | 'Partially True'
  | 'Wrong Scope'
  | 'Unsupported Inference'
  | 'Reversed Logic';

export interface DistractorMeta {
  pattern: DistractorPattern;
  rationale: string;
}

/** Linked evidence pair — question A asks for a claim, question B asks for supporting evidence */
export interface EvidencePairLink {
  /** ID of the claim/interpretation question */
  claimQuestionId: string;
  /** ID of the evidence-supporting question */
  evidenceQuestionId: string;
}

export interface MCQuestion {
  id: string;
  type: MCQuestionType;
  /** Cognitive depth this question targets */
  cognitiveLevel?: CognitiveLevel;
  question: string;
  options: string[];
  answer: string;                 // single letter A/B/C/D
  explanation: string;            // rationale for the correct answer
  /** Optional sentence/paragraph references used by hard difficulty validators */
  evidence?: string[];
  /** Optional reasoning chain used by hard difficulty validators */
  reasoningSteps?: string[];
  /** Distractor metadata — keyed by option letter (wrong options only) */
  distractors?: Record<string, DistractorMeta>;
  /** If this question is part of an evidence pair, link to its sibling */
  evidencePairLink?: EvidencePairLink;
}

export interface SyntaxDeconstructionItem {
  id: string;
  original: string;
  answer: string;
}

export interface ExpansionItem {
  id: string;
  fact: string;
  conjunctions: string[];
  sampleAnswer: string;
}

export interface WorksheetData {
  title: string;
  articleSnippet: string;
  summary: {
    paragraph: string;
    blanks: string[];
  };
  multipleChoice: MCQuestion[];
  syntaxDeconstruction: SyntaxDeconstructionItem[];
  writingWorkshop: {
    expansion: ExpansionItem[];
    keywords: string[];
    qaChain: string[];
    criticalThinking: string;
  };
  keys: {
    summary: string[];
    mc: { [key: string]: string };
    syntaxDeconstruction: string[];
    expansion: string[];
    qa: string[];
    critical: string;
  };
  _meta?: {
    generatedAt: number;
    provider: AIProvider;
    model: string;
    validated: boolean;
    validationIssues: string[];
  };
}

export interface AppSettings {
  aiConfig: AIConfig;
  difficulty: Difficulty;
  teacherName: string;
  showKeys: boolean;
}

export interface ValidationIssue {
  type: 'structure' | 'rule' | 'reference';
  section: 'summary' | 'mc' | 'syntax' | 'writing' | 'keys' | 'global';
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  autoFixed: boolean;
  data: WorksheetData;
}

// ---------------------------------------------------------------------------
// Refinement
// ---------------------------------------------------------------------------

/** Severity groups for refinement routing */
export type IssueGroup = 'critical' | 'major' | 'minor';

/** Per-round report produced after each refinement attempt */
export interface RefinementReport {
  round: number;
  fixedIssues: ValidationIssue[];
  remainingIssues: ValidationIssue[];
  introducedIssues: ValidationIssue[];
  sectionsModified: string[];
  checklistPassed: boolean;
  /** True if refinement made things worse (new critical issues) */
  degraded: boolean;
}

export interface Project {
  id: string;
  title: string;
  articleText: string;
  difficulty: Difficulty;
  createdAt: number;
  updatedAt: number;
  worksheets: WorksheetData[];
}

export interface ProjectMeta {
  id: string;
  title: string;
  difficulty: Difficulty;
  createdAt: number;
  updatedAt: number;
  worksheetCount: number;
}

export const PROVIDER_MODELS: Record<AIProvider, { label: string; value: string }[]> = {
  gemini: [
    { label: 'Flash', value: 'gemini-3-flash-preview' },
    { label: 'Pro', value: 'gemini-3-pro-preview' },
  ],
  deepseek: [
    { label: 'DeepSeek V3', value: 'deepseek-chat' },
    { label: 'DeepSeek R1', value: 'deepseek-reasoner' },
  ],
  kimi: [
    { label: 'Moonshot v1 8k', value: 'moonshot-v1-8k' },
    { label: 'Moonshot v1 32k', value: 'moonshot-v1-32k' },
    { label: 'Moonshot v1 128k', value: 'moonshot-v1-128k' },
  ],
  custom: [
    { label: 'Custom Model', value: 'custom-model' },
  ],
};

export const PROVIDER_DEFAULTS: Record<AIProvider, { model: string }> = {
  gemini: { model: 'gemini-3-flash-preview' },
  deepseek: { model: 'deepseek-chat' },
  kimi: { model: 'moonshot-v1-8k' },
  custom: { model: 'custom-model' },
};
