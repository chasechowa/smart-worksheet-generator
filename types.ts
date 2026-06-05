
export type Difficulty = 'A2' | 'B1' | 'B2' | 'C1';

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

export interface MCQuestion {
  id: string;
  type: 'Main Idea' | 'Vocabulary in Context' | 'Detail & Inference' | 'Function/Tone' | 'Paraphrase' | 'Finding Evidence';
  question: string;
  options: string[];
  answer: string;
  explanation: string;
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
