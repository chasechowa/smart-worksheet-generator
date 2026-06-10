import { WorksheetData, Difficulty, AIConfig, AIProvider, ValidationIssue, IssueGroup, RefinementReport } from "../types";
import { getActiveConfig } from "./configService";
import { getDifficultyProfile } from "./difficultyProfiles";

// Detect if we're in Electron with IPC proxy available
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.invokeApiCall;

// CF Worker proxy URLs — tried in order, 3s timeout per attempt
// 国内访问：如果自定义域名不可用，会 fallback 到直连
const DEFAULT_PROXIES: string[] = [
  'https://api.comprequiz.chao.asia',
  'https://smart-worksheet-proxy.saberking8.workers.dev',
];

/** 读取用户自定义代理 URL（localStorage） */
function getUserProxy(): string | null {
  try {
    const raw = localStorage.getItem('vocabforge_custom_proxy');
    if (raw) return raw.trim();
  } catch { /* localStorage 不可用 */ }
  return null;
}

async function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  // 路径 1：Electron 桌面版 → IPC 代理
  if (isElectron) {
    const result = await (window as any).electronAPI.invokeApiCall(url, options);
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }

  // 构建代理列表：用户自定义 + 默认
  const proxies: string[] = [];
  const userProxy = getUserProxy();
  if (userProxy) proxies.push(userProxy);
  proxies.push(...DEFAULT_PROXIES);

  // 路径 2：浏览器 → Worker 代理
  let lastError: string | null = null;
  for (const proxyUrl of proxies) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s 超时

      const proxyHeaders: Record<string, string> = {
        'X-Target-URL': url,
        'Content-Type': 'application/json',
      };

      if (options?.headers) {
        const h = options.headers as Record<string, string>;
        if (h['Authorization']) proxyHeaders['Authorization'] = h['Authorization'];
        if (h['Content-Type']) proxyHeaders['Content-Type'] = h['Content-Type'];
      }

      const resp = await fetch(proxyUrl, {
        method: 'POST',
        headers: proxyHeaders,
        body: options?.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (resp.ok || resp.status >= 400) {
        return resp;
      }
      lastError = `Proxy returned ${resp.status}`;
    } catch (err: any) {
      lastError = err.name === 'AbortError' ? `Proxy ${proxyUrl} timed out` : err.message;
      continue;
    }
  }

  // 路径 3：直连（Gemini 原生支持 CORS；DeepSeek/Kimi 国内可能可用）
  try {
    const resp = await fetch(url, options as RequestInit);
    return resp;
  } catch (err: any) {
    // 给出明确的错误信息
    const detail = lastError || err.message;
    throw new Error(
      `API request failed — proxy unreachable and direct connection blocked.\n` +
      `Proxy status: ${detail}\n` +
      `Direct status: ${err.message}\n\n` +
      `Troubleshooting:\n` +
      `• Check your network connection\n` +
      `• Set a custom proxy URL in AI Configuration\n` +
      `• For Chinese users: try DeepSeek or Kimi (domestic API)`
    );
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1500): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error.toString().toLowerCase() + (error.message || '').toLowerCase();
    if (
      errorMsg.includes('quota') ||
      errorMsg.includes('429') ||
      errorMsg.includes('resource_exhausted') ||
      errorMsg.includes('rate limit') ||
      errorMsg.includes('insufficient balance') ||
      errorMsg.includes('402') ||
      errorMsg.includes('payment required') ||
      errorMsg.includes('api key invalid') ||
      errorMsg.includes('unauthorized') ||
      errorMsg.includes('model not found') ||
      errorMsg.includes('not found')
    ) {
      throw error;
    }
    if (retries <= 0) throw error;
    console.warn(`Attempt failed (${retries} retries left). Retrying in ${delay}ms...`, error.message);
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

function buildPrompt(article: string, difficulty: Difficulty): string {
  const profile = getDifficultyProfile(difficulty);

  return `
    You are a professional ESL/EFL developer creating PSAT/SAT and IELTS level materials.

    ${profile.learnerDescription}

    ═══════════════════════════════════════════════════════════════
    CRITICAL — VERBATIM RULE
    Any answer, blank, keyword, or quoted sentence that claims to come
    from the article MUST be an EXACT verbatim substring found in the
    article text. No paraphrasing, no synonyms, no rewording.
    After generating, mentally grep each such item against the article.
    ═══════════════════════════════════════════════════════════════

    VOCABULARY CONSTRAINTS:
    ${profile.vocabulary.guidance}

    SENTENCE CONSTRAINTS:
    ${profile.sentence.guidance}

    ═══════════════════════════════════════════════════════════════
    SECTION-SPECIFIC DIFFICULTY CONTROLS:
    ═══════════════════════════════════════════════════════════════

    Worksheet Structure (MANDATORY 5 PARTS):

    Part 1 (IELTS Summary): A paragraph with exactly 5 [BLANK] tokens.
    - ${profile.summary.guidance}
    - Each blank answer MUST be a verbatim substring from the article (max ${profile.summary.maxBlankWords} word${profile.summary.maxBlankWords > 1 ? 's' : ''}).
    - Verify: open the article, search for each blank answer. It must be there word-for-word.
    - Do NOT use synonyms, derived forms, or paraphrased phrases.

    Part 2 (Reading Logic — IELTS/TOEFL/SAT Quality): Exactly 10 Multiple Choice questions.
    - ${profile.mcQuestions.guidance}
    - PRIMARY GOAL: Assess comprehension, inference, reasoning, synthesis, and rhetorical analysis.
      Do NOT merely test information retrieval.

    COGNITIVE TARGETS (${profile.label}):
    - Retrieval (direct sentence-level): ${Math.round(profile.mcQuestions.cognitiveRatios.retrieval * 100)}%
    - Inference (multi-sentence, implications): ${Math.round(profile.mcQuestions.cognitiveRatios.inference * 100)}%
    - Synthesis (transfer, evaluation): ${Math.round(profile.mcQuestions.cognitiveRatios.synthesis * 100)}%
    - Maximum ${profile.mcQuestions.maxRetrievalQuestions} questions may be answered by direct single-sentence retrieval.
    - At least ${profile.mcQuestions.minInferenceQuestions} questions must require multi-sentence combination.
    - At least ${profile.mcQuestions.minSynthesisQuestions} questions must require synthesis or evaluation.

    TYPE DISTRIBUTION (EXACT — 10 total):
    ┌──────────────────────────────┬────────┬──────────────────────────────────────────────┐
    │ Type                         │ Count  │ Tests                                        │
    ├──────────────────────────────┼────────┼──────────────────────────────────────────────┤
    │ Main Idea                    │   1    │ Overall purpose, central claim, thesis        │
    │ Literal Comprehension        │   2    │ Direct recall of stated facts                 │
    │ Inference                    │   3    │ Combine info, unstated implications            │
    │ Evidence Reasoning           │   2    │ Linked pair: claim + supporting evidence       │
    │ Vocabulary in Context        │   1    │ Contextual meaning, NOT dictionary definition │
    │ Structure/Function/Synthesis │   1    │ Author's purpose, paragraph role, idea transfer│
    └──────────────────────────────┴────────┴──────────────────────────────────────────────┘

    EVIDENCE REASONING — LINKED PAIR (CRITICAL):
    Generate EXACTLY ONE evidence pair of 2 consecutive questions:
    - Question A (id: "qN"): asks for a conclusion, claim, inference, or interpretation.
    - Question B (id: "qN+1"): asks which quotation / sentence / evidence best supports the answer to Question A.
    - Both questions must have "type": "Evidence Reasoning".
    - Add an "evidencePairLink" field to each: { "claimQuestionId": "qN", "evidenceQuestionId": "qN+1" }.

    INFERENCE QUESTION STANDARD:
    A question is NOT inference if: the answer is explicitly stated in one sentence;
    it can be found through keyword matching; the student only needs to locate a fact.
    A valid inference question MUST require at least one of:
    - combining information from multiple sentences;
    - identifying an unstated implication;
    - determining a likely consequence;
    - connecting cause and effect across ideas.

    TRANSFER QUESTION REQUIREMENT:
    At least ONE question must be a TRANSFER question (cognitiveLevel: "synthesis").
    A transfer question asks students to:
    - apply a concept from the passage to a new situation;
    - predict an outcome in a novel context;
    - identify a parallel example;
    - extend the author's reasoning beyond the text.
    The correct answer MUST NOT appear directly in the passage.
    Students must demonstrate conceptual understanding rather than retrieval.

    EVIDENCE REASONING — LINKED PAIR (CRITICAL):
    Generate EXACTLY ONE linked SAT-style evidence pair:
    - Question A: asks for an inference, conclusion, interpretation, or claim.
    - Question B: asks which quotation / sentence / evidence best supports the answer to Question A.
    - Both questions must have "type": "Evidence Reasoning".
    - Add "evidencePairLink" to each: { "claimQuestionId": "<qA_id>", "evidenceQuestionId": "<qB_id>" }.

    STRUCTURE / FUNCTION QUESTIONS:
    At least ONE question must ask students to analyze:
    - the purpose of an example;
    - the role of a paragraph;
    - the function of a piece of evidence;
    - how the author develops the argument.

    VOCABULARY IN CONTEXT:
    Do NOT test simple dictionary meanings. All four options must be PLAUSIBLE academic vocabulary choices.
    Prefer options like: "indispensable / conventional / superficial / temporary"
    Avoid simple synonym lists like: "basic / key / vital / deep"

    DISTRACTOR PATTERNS (every incorrect option MUST be tagged):
    ┌──────────────────────────┬──────────────────────────────────────────────────┐
    │ Pattern                  │ Description                                       │
    ├──────────────────────────┼──────────────────────────────────────────────────┤
    │ "Too Broad"              │ True in general but overstates the passage        │
    │ "Too Narrow"             │ True but only a minor detail, misses the point    │
    │ "Partially True"         │ Some truth mixed with an incorrect element        │
    │ "Wrong Scope"            │ Right topic, wrong paragraph or context           │
    │ "Unsupported Inference"  │ Could be true but no passage evidence             │
    │ "Reversed Logic"         │ Reverses cause/effect or flips the relationship   │
    └──────────────────────────┴──────────────────────────────────────────────────┘

    DISTRACTOR TEST — Before finalizing each question, ask:
    "Could a student who partially understood the passage reasonably choose this option?"
    If the answer is NO, rewrite the distractor.
    Do NOT generate obviously incorrect distractors. Patterns must be distributed evenly.

    - OPTION LENGTH: All 4 options within ~30% character count of each other.
    - ANSWER DISTRIBUTION: Correct answers evenly distributed among A/B/C/D (2-3 each).
    - Options: Raw text only, no "A.", "B)", "1." prefixes.
    - Answer format: Single letter "A"/"B"/"C"/"D".
    - Every question: non-empty "explanation" + "cognitiveLevel" ("retrieval"|"inference"|"synthesis").

    Part 3 (Syntax Deconstruction):
    - ${profile.syntax.guidance}
    - Select EXACTLY 2 sentences that provide the GREATEST GRAMMATICAL LEARNING VALUE.
    - Do NOT select a sentence merely because it is LONG.
    - Choose sentences that would be useful for advanced ESL learners to analyze and deconstruct.

    PRIORITIZE sentences containing these grammatical features:
    ┌──────────────────────────┬──────────────────────────────────────────────────┐
    │ Feature                  │ Example                                          │
    ├──────────────────────────┼──────────────────────────────────────────────────┤
    │ Relative clauses         │ "...the policy, which was enacted in 2020, ..."  │
    │ Noun clauses             │ "The study revealed that climate patterns..."     │
    │ Adverbial clauses        │ "Although costs rose, demand remained steady"    │
    │ Participle phrases       │ "Having analyzed the data, the researchers..."   │
    │ Appositives              │ "Dr. Chen, a leading economist, argued that..."  │
    │ Inversion                │ "Not only did temperatures rise, but..."         │
    │ Reduced clauses          │ "The results, when compared to prior studies..." │
    │ Complex embedding        │ 3+ levels of clause nesting                      │
    └──────────────────────────┴──────────────────────────────────────────────────┘

    - The "original" field MUST be the exact sentence copied VERBATIM from the article text.
      Do NOT paraphrase, shorten, or modify punctuation.
    - Provide a model decomposition into simple clauses in the "answer" field.
      Label each clause type (e.g., "Main clause", "Relative clause", "Adverbial clause").
    - Verify: search the article to confirm the "original" text is there word-for-word.

    Part 4 (Writing & Logic Workshop):
    - ${profile.writing.guidance}
    - A (Sentence Expansion): Extract EXACTLY 4 simple factual statements from the article. Provide 2-3 level-appropriate conjunctions per fact.
      Suggested conjunctions for this level: ${profile.writing.conjunctionExamples.join(', ')}.
    - B (Keywords): Extract 5 core keywords. Each keyword MUST be a word or short phrase that literally appears in the article text. Do NOT invent thematic keywords — grep the article.
    - C (Q&A): 4 open-ended questions at ${profile.writing.qaComplexity} level.
    - D (Critical Thinking): 1 ${profile.writing.criticalThinkingType} prompt about the article's claims or implications.

    Part 5 (Teacher Key): Accurate answer keys for ALL parts.
    - mc keys: letter A/B/C/D matching the correct option text.
    - All other keys: the correct answer text for each item.

    ═══════════════════════════════════════════════════════════════
    SELF-CHECK BEFORE OUTPUT:
    □ No more than ${profile.mcQuestions.maxRetrievalQuestions} direct retrieval questions
    □ At least ${profile.mcQuestions.minInferenceQuestions} genuine inference questions (not keyword-matchable)
    □ Exactly 1 evidence pair (claim Q + evidence Q, explicitly linked)
    □ At least 1 structure/function question
    □ At least 1 transfer/synthesis question (answer not in passage)
    □ Vocabulary options are all academically plausible
    □ Every wrong option passes the distractor test ("could a student reasonably choose this?")
    □ No absurd or obviously false distractors
    □ Summary blanks: every answer exists verbatim in article
    □ Syntax original sentences: exist verbatim in article
    □ Keywords: exist verbatim in article
    □ No empty fields anywhere
    □ Exactly 10 MCQ, 5 blanks, 2 syntax items, 4 expansions, 5 keywords, 4 Q&A, 1 criticalThinking
    If any check fails, fix that item before returning.
    ═══════════════════════════════════════════════════════════════

    Output format: JSON only.
    {
      "title": "A Compelling Title",
      "articleSnippet": "~200-word verbatim excerpt from the article",
      "summary": { "paragraph": "Summary with [BLANK]...", "blanks": ["key1", "key2", "key3", "key4", "key5"] },
      "multipleChoice": [
        {
           "id": "q1",
           "type": "Literal Comprehension",
           "cognitiveLevel": "retrieval",
           "question": "According to the passage, what is the primary cause of X?",
           "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
           "answer": "A",
           "explanation": "The passage states directly that...",
           "distractors": {
             "B": { "pattern": "Reversed Logic", "rationale": "Reverses the cause-effect relationship stated in paragraph 2" },
             "C": { "pattern": "Too Broad", "rationale": "True of the general topic but not supported at this specific point" },
             "D": { "pattern": "Unsupported Inference", "rationale": "Plausible but the passage provides no evidence for this claim" }
           }
        },
        {
           "id": "q4",
           "type": "Evidence Reasoning",
           "cognitiveLevel": "inference",
           "question": "What can be inferred about the author's view on X?",
           "options": ["...", "...", "...", "..."],
           "answer": "B",
           "explanation": "...",
           "evidencePairLink": { "claimQuestionId": "q4", "evidenceQuestionId": "q5" },
           "distractors": { "A": {...}, "C": {...}, "D": {...} }
        },
        {
           "id": "q5",
           "type": "Evidence Reasoning",
           "cognitiveLevel": "inference",
           "question": "Which quotation provides the best evidence for the answer to the previous question?",
           "options": ["'...'", "'...'", "'...'", "'...'"],
           "answer": "C",
           "explanation": "This quotation directly supports the inference made in q4.",
           "evidencePairLink": { "claimQuestionId": "q4", "evidenceQuestionId": "q5" },
           "distractors": { "A": {...}, "B": {...}, "D": {...} }
        }
      ],
      "syntaxDeconstruction": [{ "id": "s1", "original": "Exact verbatim sentence from article", "answer": "Model decomposition into clauses" }],
      "writingWorkshop": {
        "expansion": [
          { "id": "e1", "fact": "Factual statement from article", "conjunctions": ["however", "therefore"], "sampleAnswer": "Model expanded sentence" },
          { "id": "e2", "fact": "Factual statement from article", "conjunctions": ["moreover", "furthermore"], "sampleAnswer": "Model expanded sentence" },
          { "id": "e3", "fact": "Factual statement from article", "conjunctions": ["although", "despite"], "sampleAnswer": "Model expanded sentence" },
          { "id": "e4", "fact": "Factual statement from article", "conjunctions": ["because", "since"], "sampleAnswer": "Model expanded sentence" }
        ],
        "keywords": ["word1", "word2", "word3", "word4", "word5"],
        "qaChain": ["Question 1?", "Question 2?", "Question 3?", "Question 4?"],
        "criticalThinking": "Evaluative prompt about the article's claims."
      },
      "keys": {
        "summary": ["key1", "key2", "key3", "key4", "key5"],
        "mc": { "q1": "A" },
        "syntaxDeconstruction": ["sampleDecomposition1", "sampleDecomposition2"],
        "expansion": ["sampleAnswer1", "sampleAnswer2", "sampleAnswer3", "sampleAnswer4"],
        "qa": ["Answer 1", "Answer 2", "Answer 3", "Answer 4"],
        "critical": "Key guidance points for the critical thinking prompt."
      }
    }

    Article Content:
    ${article}
  `;
}

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

// ==================== Gemini Provider ====================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function detectGeminiModel(apiKey: string): Promise<string> {
  try {
    const res = await proxyFetch(`${GEMINI_API_BASE}/models?key=${apiKey}&pageSize=100`);
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []) as any[];
      const supported = models.filter(m =>
        m.supportedGenerationMethods?.includes('generateContent')
      );
      const flash = supported.find(m => m.name?.includes('flash'));
      if (flash) return flash.name.replace('models/', '');
      const gemini = supported.find(m => m.name?.includes('gemini'));
      if (gemini) return gemini.name.replace('models/', '');
    }
  } catch { /* ignore list failure */ }

  const candidates = [
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro-latest',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash',
    'gemini-pro',
  ];
  for (const model of candidates) {
    try {
      const res = await proxyFetch(`${GEMINI_API_BASE}/models/${model}?key=${apiKey}`);
      if (res.ok) return model;
    } catch { /* ignore probe failure */ }
  }

  return 'gemini-1.5-flash-latest';
}

const callGemini = async (prompt: string, modelName: string, apiKey: string): Promise<WorksheetData> => {
  const model = modelName === 'auto' ? await detectGeminiModel(apiKey) : modelName;
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const response = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 400 && body.includes('API key not valid')) {
      throw new Error(`API key invalid (${response.status}). Please check your API key.`);
    }
    if (response.status === 404) {
      throw new Error(`Model not found (${response.status}). No available Gemini model for this API key.`);
    }
    if (response.status === 429) {
      throw new Error(`Rate limit exceeded (${response.status}). Please try again later.`);
    }
    throw new Error(`Gemini API Error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const jsonText = extractJSON(content);

  try {
    return JSON.parse(jsonText) as WorksheetData;
  } catch (parseErr: any) {
    console.error("Failed to parse JSON from Gemini response:", content);
    throw new Error(`Failed to parse API response: ${parseErr.message}`);
  }
};

// ==================== OpenAI-Compatible Provider ====================

const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  kimi: 'https://api.moonshot.cn/v1',
};

const PROVIDER_MAX_TOKENS: Record<string, number> = {
  deepseek: 8192,
  kimi: 16384,
};

function getBaseUrl(provider: AIProvider, customUrl?: string): string {
  if (provider === 'custom') {
    if (!customUrl || !customUrl.startsWith('http')) {
      throw new Error('Custom provider requires a valid HTTP/HTTPS base URL');
    }
    return customUrl.replace(/\/$/, '');
  }
  return PROVIDER_BASE_URLS[provider];
}

const callOpenAICompatible = async (
  prompt: string,
  modelName: string,
  apiKey: string,
  provider: AIProvider,
  baseUrl?: string
): Promise<WorksheetData> => {
  const resolvedBase = getBaseUrl(provider, baseUrl);
  const url = resolvedBase + '/chat/completions';

  const body: any = {
    model: modelName,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: PROVIDER_MAX_TOKENS[provider] || 8192,
    response_format: { type: 'json_object' },
  };

  const response = await proxyFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`API Error ${response.status} from ${provider}:`, errorBody);
    if (response.status === 401 || response.status === 403) {
      throw new Error(`API key invalid or unauthorized (${response.status}). Please check your API key.`);
    }
    if (response.status === 402) {
      throw new Error(`Insufficient balance (${response.status}). Your API account has no remaining credit.`);
    }
    if (response.status === 429) {
      throw new Error(`Rate limit exceeded (${response.status}). Please try again later.`);
    }
    throw new Error(`API Error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  const jsonText = extractJSON(content);

  try {
    return JSON.parse(jsonText) as WorksheetData;
  } catch (parseErr: any) {
    console.error("Failed to parse JSON from API response:", content);
    const trimmed = content.trim();
    if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
      throw new Error(`AI response was truncated (incomplete JSON). The model ran out of output tokens. Try a shorter article or a model with a larger context window.`);
    }
    throw new Error(`Failed to parse API response: ${parseErr.message}`);
  }
};

// ==================== Unified Dispatch ====================

async function callAI(prompt: string, aiConfig: AIConfig): Promise<WorksheetData> {
  switch (aiConfig.provider) {
    case 'gemini':
      return callGemini(prompt, aiConfig.model, aiConfig.apiKey);
    case 'deepseek':
    case 'kimi':
    case 'custom':
      return callOpenAICompatible(prompt, aiConfig.model, aiConfig.apiKey, aiConfig.provider, aiConfig.baseUrl);
    default:
      throw new Error(`Unsupported provider: ${aiConfig.provider}`);
  }
}

// ==================== Refinement (self-correction) ====================

const MAX_REFINEMENT_ROUNDS = 2;

// ---------------------------------------------------------------------------
// Issue classification
// ---------------------------------------------------------------------------

/**
 * Map a validation issue to its severity group for refinement routing.
 *
 *   critical — no recovery possible (entire section missing, global breakage)
 *   major    — structural errors refinement CAN fix (wrong counts, empty fields)
 *   minor    — quality issues (not in article, length varies, distribution)
 */
export function classifyIssue(issue: ValidationIssue): IssueGroup {
  // --- Critical: section entirely missing ---
  if (issue.type === 'structure' && /is missing/i.test(issue.message)) {
    return 'critical';
  }

  // --- Critical: global breakage ---
  if (issue.section === 'global' && issue.severity === 'error') {
    return 'critical';
  }

  // --- Major: recoverable structural / rule errors ---
  if (issue.severity === 'error') {
    return 'major';
  }

  // --- Minor: quality warnings ---
  return 'minor';
}

/**
 * Partition issues into critical / major / minor groups.
 */
function groupIssues(issues: ValidationIssue[]): {
  critical: ValidationIssue[];
  major: ValidationIssue[];
  minor: ValidationIssue[];
} {
  const critical: ValidationIssue[] = [];
  const major: ValidationIssue[] = [];
  const minor: ValidationIssue[] = [];

  for (const issue of issues) {
    const group = classifyIssue(issue);
    switch (group) {
      case 'critical': critical.push(issue); break;
      case 'major': major.push(issue); break;
      case 'minor': minor.push(issue); break;
    }
  }

  return { critical, major, minor };
}

// ---------------------------------------------------------------------------
// Self-verification checklist (embedded in refinement prompt)
// ---------------------------------------------------------------------------

function buildSelfCheckChecklist(): string {
  return `
═══════════════════════════════════════════════════════════════
SELF-VERIFICATION — Before returning JSON, mentally verify:
═══════════════════════════════════════════════════════════════
□  MC count         = 10
□  Literal Comprehension = 2
□  Inference = 2
□  Evidence Reasoning = 2
□  Vocabulary in Context = 1
□  Rhetorical Function = 1
□  Text Structure = 1
□  Synthesis = 1
□  Summary blanks    = 5
□  Syntax items     = 2
□  Expansion items  = 4
□  Keywords         = 5
□  QA questions     = 4
□  Critical Thinking = 1
□  All MC answers are A/B/C/D letters — never option text
□  Answer keys present for ALL sections
□  No empty strings in any field
□  All blank/keyword/syntax answers exist verbatim in article
If ANY check fails, fix that item before returning.
═══════════════════════════════════════════════════════════════`;
}

// ---------------------------------------------------------------------------
// Build refinement prompt
// ---------------------------------------------------------------------------

function buildRefinementPrompt(
  currentData: WorksheetData,
  allIssues: ValidationIssue[],
  article: string,
  difficulty: Difficulty,
): string {
  const profile = getDifficultyProfile(difficulty);
  const { major, minor } = groupIssues(allIssues);
  const fixableIssues = [...major, ...minor];

  const issueList = fixableIssues.map((w, i) =>
    `  ${i + 1}. [${w.severity.toUpperCase()}] [${w.section}] ${w.message}${w.suggestion ? ` — Suggestion: ${w.suggestion}` : ''}`
  ).join('\n');

  const sectionList = [
    '"summary"', '"multipleChoice"', '"syntaxDeconstruction"',
    '"writingWorkshop"', '"keys"',
  ].join(', ');

  return `
You previously generated an ESL/EFL worksheet (difficulty: ${difficulty}) based on this article. Fix issues while maintaining ${profile.label} level constraints.

---
${article}
---

ISSUES TO FIX (${fixableIssues.length} total — ${major.length} structural, ${minor.length} quality):
${issueList}

CURRENT WORKSHEET JSON:
\`\`\`json
${JSON.stringify(currentData, null, 2)}
\`\`\`

${buildSelfCheckChecklist()}

═══════════════════════════════════════════════════════════════
DO NOT MODIFY:
═══════════════════════════════════════════════════════════════
- Sections with zero issues: ${sectionList}
- Any question/item IDs (q1, q2, ..., s1, s2, e1-e4)
- The overall JSON structure
- The "title" field (unless it was flagged)
- The "articleSnippet" field
- Any field that already passes validation
Only modify the specific fields mentioned in the issues above.
═══════════════════════════════════════════════════════════════

INSTRUCTIONS:
1. Fix ALL the issues listed above. Do not change anything else.
2. For "not found in article" issues: replace with a verbatim phrase from the article.
3. For "option length varies": rewrite so all 4 options are within ~30% character count.
4. For "sentence not matching": extract the EXACT sentence from the article.
5. For "type distribution": LitComp=2, Inference=2, Evidence=2, Vocab=1, Rhetorical=1, Structure=1, Synthesis=1.
6. For count mismatches: add or remove items to reach the required count.
7. For empty fields: fill with valid content derived from the article.
8. Keep IDs unchanged so answer keys remain valid.
9. Ensure answer keys are updated to match any content changes.
10. All MC answers MUST be single letters A/B/C/D.
11. Answer distribution: 2-3 correct answers per letter A/B/C/D.
12. Run the self-verification checklist above before outputting.

Output: Return ONLY valid JSON, no markdown fences, no explanation.
`;
}

// ---------------------------------------------------------------------------
// Post-refinement diff checking
// ---------------------------------------------------------------------------

interface SectionDiff {
  section: ValidationIssue['section'];
  changed: boolean;
  beforeKeys: number;
  afterKeys: number;
}

/**
 * Compare pre-refinement and post-refinement data to detect
 * unintended modifications to sections that had no issues.
 */
function computeRefinementDiff(
  before: WorksheetData,
  after: WorksheetData,
  targetIssues: ValidationIssue[],
): { diffs: SectionDiff[]; modifiedButClean: string[] } {
  const targetSections = new Set(targetIssues.map(i => i.section));
  const diffs: SectionDiff[] = [];
  const modifiedButClean: string[] = [];

  // Compare each major section for structural changes
  const comparisons: { section: ValidationIssue['section']; before: any; after: any }[] = [
    { section: 'summary' as const, before: before.summary, after: after.summary },
    { section: 'mc' as const, before: before.multipleChoice?.length, after: after.multipleChoice?.length },
    { section: 'syntax' as const, before: before.syntaxDeconstruction?.length, after: after.syntaxDeconstruction?.length },
    { section: 'writing' as const, before: before.writingWorkshop, after: after.writingWorkshop },
    { section: 'keys' as const, before: before.keys, after: after.keys },
  ];

  for (const { section, before: b, after: a } of comparisons) {
    const beforeStr = JSON.stringify(b);
    const afterStr = JSON.stringify(a);
    const changed = beforeStr !== afterStr;

    diffs.push({
      section,
      changed,
      beforeKeys: beforeStr.length,
      afterKeys: afterStr.length,
    });

    // If a section was changed but had NO issues reported against it,
    // that's an unintended modification
    if (changed && !targetSections.has(section)) {
      modifiedButClean.push(section);
    }
  }

  return { diffs, modifiedButClean };
}

// ---------------------------------------------------------------------------
// Refinement report generation
// ---------------------------------------------------------------------------

function generateRefinementReport(
  round: number,
  beforeIssues: ValidationIssue[],
  afterIssues: ValidationIssue[],
  diffs: SectionDiff[],
  modifiedButClean: string[],
): RefinementReport {
  // Issues that were present before but gone after → fixed
  const fixedIssues = beforeIssues.filter(before =>
    !afterIssues.some(after =>
      after.section === before.section &&
      after.message === before.message
    )
  );

  // Issues that remain in both → remaining
  const remainingIssues = afterIssues.filter(after =>
    beforeIssues.some(before =>
      before.section === after.section &&
      before.message === after.message
    )
  );

  // Issues present after but not before → introduced
  const introducedIssues = afterIssues.filter(after =>
    !beforeIssues.some(before =>
      before.section === after.section &&
      before.message === after.message
    )
  );

  const sectionsModified = diffs.filter(d => d.changed).map(d => d.section);
  const degraded = introducedIssues.some(i => classifyIssue(i) === 'critical');

  // Checklist passes if no structural errors remain
  const checklistPassed = afterIssues.filter(i => i.severity === 'error').length === 0;

  return {
    round,
    fixedIssues,
    remainingIssues,
    introducedIssues,
    sectionsModified,
    checklistPassed,
    degraded,
  };
}

// ---------------------------------------------------------------------------
// Refine worksheet (single round)
// ---------------------------------------------------------------------------

async function refineWorksheet(
  currentData: WorksheetData,
  issues: ValidationIssue[],
  article: string,
  difficulty: Difficulty,
): Promise<WorksheetData> {
  const aiConfig = getActiveConfig();
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('No active AI provider configured.');
  }
  const prompt = buildRefinementPrompt(currentData, issues, article, difficulty);
  return withRetry(() => callAI(prompt, aiConfig));
}

// ---------------------------------------------------------------------------
// Main entry: generate + auto-refine
// ---------------------------------------------------------------------------

export async function generateAndRefine(
  article: string,
  difficulty: Difficulty,
  onRound?: (round: number, data: WorksheetData, report: RefinementReport) => void,
): Promise<{ data: WorksheetData; rounds: number; reports: RefinementReport[] }> {
  const aiConfig = getActiveConfig();
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('No active AI provider configured. Please set up your API key in Settings.');
  }

  const reports: RefinementReport[] = [];

  // --- Initial generation ---
  const prompt = buildPrompt(article, difficulty);
  let data = await withRetry(() => callAI(prompt, aiConfig));
  let rounds = 0;

  // Dynamic import to avoid circular dependency
  const { validateAll } = await import('../validators');

  for (let r = 0; r < MAX_REFINEMENT_ROUNDS; r++) {
    const { issues: beforeIssues, fixedData } = validateAll(data, article);
    data = fixedData; // Apply mechanical auto-fixes

    const { critical, major, minor } = groupIssues(beforeIssues);

    // --- Critical issues → abort immediately ---
    if (critical.length > 0 && rounds === 0) {
      reports.push({
        round: 0,
        fixedIssues: [],
        remainingIssues: beforeIssues,
        introducedIssues: [],
        sectionsModified: [],
        checklistPassed: false,
        degraded: false,
      });
      break;
    }

    // --- No fixable issues → done ---
    if (major.length === 0 && minor.length === 0) {
      break;
    }

    // --- Send ALL fixable issues (major + minor) to refinement ---
    const beforeData = { ...data };
    const fixableIssues = [...major, ...minor];

    rounds++;
    try {
      data = await refineWorksheet(data, fixableIssues, article, difficulty);
    } catch (err: any) {
      console.warn(`Refinement round ${r + 1} failed:`, err?.message || err);
      break;
    }

    // --- Post-refinement validation ---
    const { issues: afterIssues, fixedData: afterFixed } = validateAll(data, article);
    data = afterFixed;

    // --- Diff check ---
    const { diffs, modifiedButClean } = computeRefinementDiff(beforeData, data, fixableIssues);

    // --- Generate report ---
    const report = generateRefinementReport(
      rounds,
      beforeIssues,
      afterIssues,
      diffs,
      modifiedButClean,
    );
    reports.push(report);
    onRound?.(rounds, data, report);

    // --- Degradation check: rollback if refinement made things worse ---
    if (report.degraded) {
      console.warn(`Refinement round ${rounds} introduced critical issues — rolling back.`);
      data = beforeData;
      break;
    }

    // --- If no issues remain, we're done ---
    const { major: remMajor, minor: remMinor } = groupIssues(afterIssues);
    if (remMajor.length === 0 && remMinor.length === 0) {
      break;
    }

    // --- If only minor issues remain after 2 rounds, accept as-is ---
    if (remMajor.length === 0 && rounds >= MAX_REFINEMENT_ROUNDS) {
      break;
    }
  }

  return { data, rounds, reports };
}

// ==================== Public API ====================

export const generateWorksheet = async (
  article: string,
  difficulty: Difficulty,
): Promise<WorksheetData> => {
  const aiConfig = getActiveConfig();
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('No active AI provider configured. Please set up your API key in Settings.');
  }
  const prompt = buildPrompt(article, difficulty);
  return withRetry(() => callAI(prompt, aiConfig));
};
