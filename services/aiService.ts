import { WorksheetData, Difficulty, AIConfig, AIProvider, ValidationIssue } from "../types";
import { getActiveConfig } from "./configService";

// Detect if we're in Electron with IPC proxy available
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.invokeApiCall;

async function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  if (isElectron) {
    const result = await (window as any).electronAPI.invokeApiCall(url, options);
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }
  return fetch(url, options);
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
  return `
    You are a professional ESL/EFL developer creating PSAT/SAT and IELTS level materials.
    Adjust linguistic complexity for the target level: ${difficulty}.

    ═══════════════════════════════════════════════════════════════
    CRITICAL — VERBATIM RULE
    Any answer, blank, keyword, or quoted sentence that claims to come
    from the article MUST be an EXACT verbatim substring found in the
    article text. No paraphrasing, no synonyms, no rewording.
    After generating, mentally grep each such item against the article.
    ═══════════════════════════════════════════════════════════════

    Worksheet Structure (MANDATORY 5 PARTS):

    Part 1 (IELTS Summary): A paragraph with exactly 5 [BLANK] tokens.
    - Each blank answer MUST be a verbatim substring from the article (1-3 words).
    - Verify: open the article, search for each blank answer. It must be there word-for-word.
    - Do NOT use synonyms, derived forms, or paraphrased phrases.

    Part 2 (Reading Logic - SAT/IELTS Style): Exactly 10 Multiple Choice questions.
    - STRICT STYLE: Imitate official SAT/IELTS Reading questions.
    - DISTRACTORS: THIS IS CRITICAL. Distractors must be HIGHLY PLAUSIBLE based on common student misconceptions (e.g., true statement but wrong paragraph, too broad, too narrow, tempting but incorrect inference).
    - OPTION LENGTH: All 4 options within a question MUST be within ~30% of each other in character count. If one option is 40 chars, the others must be 28-52 chars. Uneven lengths make the answer obvious — this is a hard requirement.
    - ANSWER DISTRIBUTION: Ensure correct answers are evenly distributed among A, B, C, D (2-3 each). Do NOT cluster answers in B or C. Randomize the correct option position.
    - QUESTION TYPE DISTRIBUTION:
      * EXACTLY 2 "Finding Evidence" (Command of Evidence). Options must be direct quotes or specific line references from the article.
      * MAX 1 "Vocabulary in Context".
      * Remaining 7-8: cover Main Idea, Detail & Inference, Function/Tone.
    - Options: Return raw option text only. No "A.", "B)", "1." prefixes.
    - Every question MUST include a non-empty "explanation" field justifying the correct answer.

    Part 3 (Syntax Deconstruction):
    - Select the 2 longest, most grammatically complex sentences from the article.
    - The "original" field MUST be the exact sentence copied VERBATIM from the article text — do NOT paraphrase, shorten, or modify punctuation.
    - The student's task is to break each sentence into its component simple clauses — provide a model decomposition in the "answer" field.
    - Verify: search the article to confirm the "original" text is there word-for-word.

    Part 4 (Writing & Logic Workshop):
    - A (Sentence Expansion): Extract EXACTLY 4 simple factual statements from the article. Provide 2-3 appropriate conjunctions per fact, and a model expanded sentence.
    - B (Keywords): Extract 5 core keywords. Each keyword MUST be a word or short phrase that literally appears in the article text. Do NOT invent thematic keywords — grep the article.
    - C (Q&A): 4 logical open-ended questions based on the article content.
    - D (Critical Thinking): 1 evaluative/argumentative prompt about the article's claims or implications.

    Part 5 (Teacher Key): Accurate answer keys for ALL parts.
    - mc keys: letter A/B/C/D matching the correct option text.
    - All other keys: the correct answer text for each item.

    ═══════════════════════════════════════════════════════════════
    SELF-CHECK BEFORE OUTPUT (do this mentally, then generate JSON):
    1. Summary blanks: grep each blank answer in the article → must match verbatim.
    2. MCQ options: check char lengths per question → within ~30% range. No duplicate options. No empty options.
    3. Syntax sentences: grep "original" text in article → must match verbatim.
    4. Keywords: grep each keyword in article → must appear literally.
    5. No empty fields anywhere: every option, fact, keyword, question, answer, and explanation must contain real content.
    6. Exactly 10 MCQ, 5 blanks, 2 syntax items, 4 expansions, 5 keywords, 4 Q&A, 1 criticalThinking prompt.
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
           "type": "Main Idea",
           "question": "Which choice best summarizes the central idea of the passage?",
           "options": ["Option text 1", "Option text 2", "Option text 3", "Option text 4"],
           "answer": "Option text 1",
           "explanation": "Explanation of why this is correct."
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

/**
 * Normalize worksheet data for refinement: convert letter answers back to option text
 * so the AI sees the correct format (answer = option text, not letter).
 */
function normalizeForRefinement(data: WorksheetData): WorksheetData {
  const mc = (data.multipleChoice || []).map(q => {
    let answerText = q.answer;
    if (/^[A-D]$/i.test(q.answer)) {
      const idx = q.answer.toUpperCase().charCodeAt(0) - 65;
      if (q.options[idx] != null) {
        answerText = q.options[idx];
      }
    }
    return { ...q, answer: answerText };
  });
  return { ...data, multipleChoice: mc };
}

function buildRefinementPrompt(
  currentData: WorksheetData,
  issues: ValidationIssue[],
  article: string,
  difficulty: Difficulty,
): string {
  const warnings = issues.filter(i => i.severity === 'warning');
  const issueList = warnings.map((w, i) =>
    `  ${i + 1}. [${w.section}] ${w.message}${w.suggestion ? ` — Suggestion: ${w.suggestion}` : ''}`
  ).join('\n');

  // Convert letter answers back to option text so AI doesn't learn the wrong format
  const safeData = normalizeForRefinement(currentData);

  return `
You previously generated an ESL/EFL worksheet (difficulty: ${difficulty}) based on this article:

---
${article}
---

Below is the worksheet you generated, in JSON format. The validator found the following quality issues (WARNINGS only — no structural errors). Your task is to fix ONLY these specific issues while keeping everything else intact.

QUALITY ISSUES TO FIX:
${issueList}

CURRENT WORKSHEET JSON:
\`\`\`json
${JSON.stringify(safeData, null, 2)}
\`\`\`

INSTRUCTIONS:
1. Fix ALL the issues listed above.
2. Do NOT change any section that has no issues.
3. Do NOT change the overall structure of the JSON.
4. For "not found in article" warnings: replace those answers/keywords with ones that actually appear in the article.
5. For "option length varies" warnings: rewrite options so all 4 are within ~30% of each other in character count.
6. For "sentence not closely matching article" warnings: extract the exact sentence from the article.
7. For "type distribution" warnings: ensure exactly 2 "Finding Evidence", at most 1 "Vocabulary in Context", and the remaining 7-8 are Main Idea / Detail & Inference / Function/Tone.
8. Keep the same IDs (q1, q2, s1, s2, e1-e4, etc.) so answer keys remain valid.
9. Ensure answer keys are updated to match any changes and each key points to the correct option letter (A/B/C/D).
10. Every field must contain actual content — no empty strings, no placeholder text.
11. Correct answers must be evenly distributed among A, B, C, D (2-3 each).
12. IMPORTANT: The "answer" field in each MCQ must be the exact text of the correct option — NOT a letter (A/B/C/D).

Output: Return ONLY valid JSON, no markdown fences, no explanation.
`;
}

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

export async function generateAndRefine(
  article: string,
  difficulty: Difficulty,
  onRound?: (round: number, data: WorksheetData, issues: ValidationIssue[]) => void,
): Promise<{ data: WorksheetData; rounds: number }> {
  const aiConfig = getActiveConfig();
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('No active AI provider configured. Please set up your API key in Settings.');
  }

  const prompt = buildPrompt(article, difficulty);
  let data = await withRetry(() => callAI(prompt, aiConfig));
  let rounds = 0;

  // Dynamic import to avoid circular dependency — validatorService re-exports validators/index
  const { validateAll } = await import('../validators');

  for (let r = 0; r < MAX_REFINEMENT_ROUNDS; r++) {
    const { issues, fixedData } = validateAll(data, article);
    // Apply mechanical auto-fixes (option stripping, answer normalization, distribution rotation)
    data = fixedData;
    const warnings = issues.filter(i => i.severity === 'warning');
    const errors = issues.filter(i => i.severity === 'error');

    if (warnings.length === 0) break;

    // If there are hard errors but no refinement rounds done yet, these are likely
    // structural AI failures — refinement won't help, break early.
    if (errors.length > 0 && rounds === 0) break;

    rounds++;
    onRound?.(rounds, data, warnings);

    try {
      data = await refineWorksheet(data, warnings, article, difficulty);
    } catch (err: any) {
      console.warn(`Refinement round ${r + 1} failed:`, err?.message || err);
      break;
    }
  }

  return { data, rounds };
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
