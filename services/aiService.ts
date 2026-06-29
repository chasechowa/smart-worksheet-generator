import { WorksheetData, Difficulty, AIConfig, AIProvider, ValidationIssue, IssueGroup, RefinementReport, GenerationOptions } from "../types";
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

// ---------------------------------------------------------------------------
// Level-specific few-shot MCQ examples
// ---------------------------------------------------------------------------

function buildMCExamples(difficulty: Difficulty): string {
  const profile = getDifficultyProfile(difficulty);
  const isC1 = difficulty === 'C1';
  const isB2 = difficulty === 'B2';

  if (isC1) {
    return `
┌─ C1 EXAMPLE 1: Multi-step Inference (3-5 reasoning hops) ───────────┐
│ Passage: "The researcher's longitudinal study found that employees  │
│ who received autonomy over their schedules reported 34% higher job  │
│ satisfaction. However, productivity metrics showed no corresponding  │
│ increase. Critics noted that self-reported satisfaction often       │
│ correlates poorly with objective performance measures in workplace  │
│ studies — a phenomenon known as the 'satisfaction-productivity      │
│ paradox' first documented by Herzberg (1968)."                      │
│                                                                     │
│ Q: The passage most strongly implies which of the following about   │
│    the relationship between autonomy and productivity?              │
│                                                                     │
│ A) Increased autonomy inevitably leads to higher productivity       │
│    → "Reversed Logic" — passage explicitly shows no increase        │
│ B) The satisfaction-productivity paradox calls into question        │
│    whether autonomy alone improves workplace outcomes               │
│    → CORRECT — synthesis of: higher satisfaction + flat             │
│      productivity + paradox concept → autonomy benefits are         │
│      limited to subjective measures, not objective ones             │
│ C) Herzberg's research has been conclusively disproven              │
│    → "Too Broad" — passage cites Herzberg but doesn't refute him    │
│ D) Self-reported satisfaction is an unreliable metric               │
│    → "Partially True" — passage says it "correlates poorly" with    │
│      productivity but doesn't claim it's unreliable overall         │
│                                                                     │
│ ✦ 4 inference hops: autonomy↑ → satisfaction↑ + productivity flat  │
│   → paradox concept → subjective ≠ objective → B is correct ✦      │
└─────────────────────────────────────────────────────────────────────┘

┌─ C1 EXAMPLE 2: Counterfactual Reasoning ────────────────────────────┐
│ Passage: "The treaty's most consequential provision was not the     │
│ tariff reduction clause — which had been anticipated — but rather   │
│ the unexpected inclusion of binding environmental standards. Had    │
│ these standards not been incorporated, subsequent cross-border      │
│ pollution agreements would likely have taken decades to negotiate   │
│ independently, according to diplomatic historians."                 │
│                                                                     │
│ Q: The passage suggests that without the environmental standards    │
│    provision, which outcome would have been MOST likely?            │
│                                                                     │
│ A) The treaty would have failed to pass entirely                    │
│    → "Unsupported Inference" — passage implies delay, not failure   │
│ B) Tariff reductions would have been less effective                 │
│    → "Wrong Scope" — tariffs and environment are separate provisions│
│ C) Cross-border pollution agreements would have faced prolonged     │
│    negotiation timelines                                             │
│    → CORRECT — counterfactual: "Had these standards not been        │
│      incorporated... would likely have taken decades"               │
│ D) Diplomatic historians would have opposed the treaty              │
│    → "Unsupported Inference" — historians analyzed, didn't oppose   │
│                                                                     │
│ ✦ Counterfactual reasoning: "had X not happened → Y would occur"   │
│   is the CORE of this question type ✦                              │
└─────────────────────────────────────────────────────────────────────┘

┌─ C1 EXAMPLE 3: Academic Vocabulary Depth ───────────────────────────┐
│ Passage: "The author's proclivity for obfuscation, while initially  │
│ appearing as mere stylistic indulgence, serves a calculated         │
│ rhetorical function: by compelling readers to parse each sentence   │
│ with unusual care, she enlists them as active participants rather   │
│ than passive consumers of her argument."                            │
│                                                                     │
│ Q: In context, 'proclivity' most nearly means:                      │
│                                                                     │
│ A) propensity    → CORRECT — "tendency or inclination"              │
│ B) antipathy     → "Reversed Logic" — opposite meaning              │
│ C) adumbration   → "Partially True" — related to 'obscuring' but    │
│    refers to foreshadowing, not habitual tendency                   │
│ D) perspicuity   → "Reversed Logic" — means clarity, opposite of    │
│    obfuscation                                                      │
│                                                                     │
│ ✦ ALL options are C1/C2 academic vocabulary. No simple synonyms ✦  │
└─────────────────────────────────────────────────────────────────────┘
`;
  }

  if (isB2) {
    return `
┌─ B2 EXAMPLE 1: Multi-paragraph Inference ───────────────────────────┐
│ Passage: "Urban planners initially championed mixed-use zoning as a │
│ cure for suburban sprawl. Two decades of data, however, reveal a    │
│ more nuanced picture: while pedestrian traffic increased 28% in     │
│ mixed-use districts, vehicle miles traveled remained statistically  │
│ unchanged. Residents were walking more but driving just as much."   │
│                                                                     │
│ Q: What can be inferred about mixed-use zoning based on the data?   │
│                                                                     │
│ A) It successfully reduced suburban sprawl                          │
│    → "Reversed Logic" — paragraph says driving unchanged            │
│ B) It improved some outcomes but failed to address car dependency   │
│    → CORRECT — walking↑ + driving flat → partial success            │
│ C) Pedestrian traffic increases are not meaningful metrics          │
│    → "Unsupported Inference" — passage doesn't evaluate metrics     │
│ D) Vehicle miles traveled would have increased without the policy   │
│    → "Unsupported Inference" — no counterfactual data provided      │
└─────────────────────────────────────────────────────────────────────┘

┌─ B2 EXAMPLE 2: Evidence Pair (Linked) ──────────────────────────────┐
│ Q4 (Evidence Reasoning): "The data suggests which conclusion about  │
│ mixed-use zoning?" (answer: B — partial success, car use unchanged) │
│ evidencePairLink: { claimQuestionId: "q4", evidenceQuestionId: "q5" }│
│                                                                     │
│ Q5 (Evidence Reasoning): "Which evidence best supports Q4?"        │
│ A) 'pedestrian traffic increased 28%' → incomplete, only half       │
│ B) 'vehicle miles traveled remained statistically unchanged'        │
│    → CORRECT — directly proves the "car use unchanged" half         │
│ C) 'mixed-use zoning was championed' → states opinion, not data     │
│ D) 'two decades of data reveal' → meta-commentary, not evidence     │
└─────────────────────────────────────────────────────────────────────┘

┌─ B2 EXAMPLE 3: Rhetorical Function ─────────────────────────────────┐
│ "The author references 'two decades of data' primarily to:"        │
│ A) emphasize the thoroughness of the research → CORRECT             │
│ B) question the methodology → "Reversed Logic" — author relies on it│
│ C) contrast with a competing study → "Wrong Scope" — no comparison  │
│ D) introduce a new topic → "Reversed Logic" — continuation, not new │
└─────────────────────────────────────────────────────────────────────┘
`;
  }

  // A2 / B1 — simpler examples
  return `
┌─ EXAMPLE 1: Literal Comprehension ──────────────────────────────────┐
│ Passage: "The Greenland ice sheet lost 267 billion metric tons      │
│ of ice per year between 2006 and 2015."                             │
│                                                                     │
│ Q: According to the passage, what happened to the ice sheet?       │
│ A) It completely melted → "Reversed Logic"                          │
│ B) It lost approximately 267 billion tons annually → CORRECT        │
│ C) It remained stable → "Reversed Logic"                            │
│ D) It gained ice → "Reversed Logic"                                 │
└─────────────────────────────────────────────────────────────────────┘

┌─ EXAMPLE 2: Basic Inference ────────────────────────────────────────┐
│ Passage: "Rainfall in the region dropped 40% below average. Crop   │
│ yields declined sharply, and several farms closed."                 │
│ Q: What can be inferred? → drought affected agriculture → CORRECT   │
└─────────────────────────────────────────────────────────────────────┘

┌─ EXAMPLE 3: Main Idea ──────────────────────────────────────────────┐
│ "The passage is mainly about:" → CORRECT uses DIFFERENT wording    │
│ than any single sentence, synthesizing the overall topic.          │
└─────────────────────────────────────────────────────────────────────┘
`;
}

function buildLevelMCBlueprint(difficulty: Difficulty): string {
  if (difficulty === 'A2') {
    return `
    A2 QUESTION BLUEPRINT (EXACT - FOLLOW THESE 10 SLOTS):
    - Q1 Main Idea, cognitiveLevel: retrieval. Ask what the whole passage is mainly about in simple words.
    - Q2 Literal Comprehension, cognitiveLevel: retrieval. Ask for one clearly stated person, thing, place, or action.
    - Q3 Literal Comprehension, cognitiveLevel: retrieval. Ask for one clearly stated fact.
    - Q4 Literal Comprehension, cognitiveLevel: retrieval. Ask what happens first/next or what a named thing does.
    - Q5 Literal Comprehension, cognitiveLevel: retrieval. Ask for a directly stated cause, result, or description.
    - Q6 Literal Comprehension, cognitiveLevel: retrieval. Ask for another directly stated key detail.
    - Q7 Vocabulary in Context, cognitiveLevel: retrieval. Target a common A1-A2 word with a clear clue in the sentence.
    - Q8 Literal Comprehension, cognitiveLevel: retrieval. Ask for one directly stated number, object, or simple action only if it is central.
    - Q9 Inference, cognitiveLevel: inference. Use one very simple inference from one sentence, such as cause/effect.
    - Q10 Structure / Function / Synthesis, cognitiveLevel: inference. Ask why one example or sentence is included, using very simple language.

    A2 BOUNDARIES:
    - No Evidence Reasoning questions.
    - No "EXCEPT", "NOT", counterfactual, rhetorical strategy, or multi-paragraph inference questions.
    - Options must be short and simple; wrong answers should be obviously wrong from the text.
    - Do not use academic vocabulary in stems or options.
`;
  }

  if (difficulty === 'B1') {
    return `
    B1 QUESTION BLUEPRINT (EXACT - FOLLOW THESE 10 SLOTS):
    - Q1 Main Idea, cognitiveLevel: inference. Ask for the main point using different words from the passage.
    - Q2 Literal Comprehension, cognitiveLevel: retrieval. Ask for a stated key fact.
    - Q3 Literal Comprehension, cognitiveLevel: retrieval. Ask for a stated cause, result, or process step.
    - Q4 Literal Comprehension, cognitiveLevel: retrieval. Ask for another stated detail that matters to the article.
    - Q5 Literal Comprehension, cognitiveLevel: retrieval. Ask for a stated comparison or example.
    - Q6 Inference, cognitiveLevel: inference. Require one-step cause/effect or purpose reasoning.
    - Q7 Inference, cognitiveLevel: inference. Require connecting two nearby details.
    - Q8 Vocabulary in Context, cognitiveLevel: inference. Target a B1 word or phrase with clear context clues.
    - Q9 Structure / Function / Synthesis, cognitiveLevel: synthesis. Ask why the author includes an example or contrast.
    - Q10 Inference, cognitiveLevel: synthesis. Ask what lesson, result, or implication follows from the passage.

    B1 BOUNDARIES:
    - No Evidence Reasoning pair.
    - No C1-style abstract critique, counterfactual reasoning, or subtle rhetorical strategy.
    - Distractors should be plausible but still clearly eliminable from the text.
    - Avoid pure trivia unless the detail is central to the article.
`;
  }

  if (difficulty === 'B2') {
    return `
    B2 QUESTION BLUEPRINT (EXACT - FOLLOW THESE 10 SLOTS):
    - Q1 Main Idea, cognitiveLevel: synthesis. Test the central argument across the whole article.
    - Q2 Literal Comprehension, cognitiveLevel: retrieval. Ask for a central stated fact, not trivia.
    - Q3 Literal Comprehension, cognitiveLevel: retrieval. Ask for another central stated detail that supports the argument.
    - Q4 Inference, cognitiveLevel: inference. Require reading between the lines across one paragraph.
    - Q5 Inference, cognitiveLevel: inference. Require connecting details from two parts of the article.
    - Q6 Evidence Reasoning, cognitiveLevel: inference. Claim question; link it to Q7 with evidencePairLink.
    - Q7 Evidence Reasoning, cognitiveLevel: inference. Evidence question for Q6; options must be short verbatim quotations.
    - Q8 Vocabulary in Context, cognitiveLevel: inference. Target a B2 academic/polysemous word or phrase.
    - Q9 Inference, cognitiveLevel: synthesis. Require evaluating an implication or likely consequence.
    - Q10 Structure / Function / Synthesis, cognitiveLevel: synthesis. Ask about author purpose, structure, or how an example supports the argument.

    B2 BOUNDARIES:
    - Maximum 2 direct retrieval questions; no standalone trivia such as "Which company..." unless it supports a broader idea.
    - The evidence pair must directly prove a claim, not merely mention the same topic.
    - Distractors should be plausible text-based misreadings, not obviously false choices.
    - Avoid C1-only demands such as 3-step abstract critique or C1/C2 vocabulary options.
`;
  }

  return `
    C1 QUESTION BLUEPRINT (EXACT - FOLLOW THESE 10 SLOTS; THIS OVERRIDES THE NON-C1 TABLE BELOW):
    - Q1 Main Idea, cognitiveLevel: synthesis. Test the central thesis without reusing the article's wording.
    - Q2 Inference, cognitiveLevel: synthesis. Require cross-paragraph synthesis; no single sentence may answer it.
    - Q3 Inference, cognitiveLevel: synthesis. Ask about an unstated implication, limitation, or tension in the author's argument.
    - Q4 Evidence Reasoning, cognitiveLevel: inference. Claim question; link it to Q5 with evidencePairLink.
    - Q5 Evidence Reasoning, cognitiveLevel: inference. Evidence question for Q4; options must be short verbatim quotations.
    - Q6 Inference, cognitiveLevel: synthesis. Require counterfactual reasoning ("if X had not happened...").
    - Q7 Structure / Function / Synthesis, cognitiveLevel: synthesis. Test rhetorical strategy or argumentative function, not topic recall.
    - Q8 Vocabulary in Context, cognitiveLevel: inference. Target an abstract, academic, or context-dependent word/phrase; all 4 options must be C1/C2-level.
    - Q9 Inference, cognitiveLevel: synthesis. Require evaluating how two details interact.
    - Q10 Structure / Function / Synthesis, cognitiveLevel: synthesis. Ask about transfer, application, or a constraint implied by the article.

    C1 BANNED QUESTION PATTERNS:
    - No standalone "Which company...", "What percentage...", "How many...", "When...", or "Where..." questions.
    - No "According to the passage..." stems.
    - No direct fact-location questions unless embedded inside a harder evidence pair.
    - No answer that can be found by keyword matching one sentence.
    - No correct answer may copy more than 6 consecutive words from the passage, except evidence quotes.

    C1 REQUIRED METADATA:
    - For every Inference and Structure / Function / Synthesis question, include:
      "evidence": ["paragraph/sentence reference 1", "paragraph/sentence reference 2"],
      "reasoningSteps": ["step 1", "step 2", "step 3"]
    - For Q4 and Q5, include matching evidencePairLink fields.
`;
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
    - Use the exact token [BLANK] five times. Do NOT write [BLANK1], [BLANK_1], "(1)____", underscores, or numbered blank tokens.
    - Each blank answer MUST be a verbatim substring from the article (max ${profile.summary.maxBlankWords} word${profile.summary.maxBlankWords > 1 ? 's' : ''}).
    - Verify: open the article, search for each blank answer. It must be there word-for-word.
    - Do NOT use synonyms, derived forms, or paraphrased phrases.

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Part 2 — MULTIPLE CHOICE READING COMPREHENSION
    Target: IELTS 7.0+ / TOEFL 25+ / SAT Evidence-Based Reading
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ╔══════════════════════════════════════════════════════════════╗
    ║  CORE EXAM MECHANISMS — These define HOW questions work    ║
    ╚══════════════════════════════════════════════════════════════╝

    M1 — EVIDENCE-BASED (SAT/IELTS/TOEFL common core)
    Every correct answer must be directly supported by specific text.
    The correct answer is the one option that CANNOT be eliminated by the passage.
    Wrong answers are eliminated by: contradiction, not stated, or misapplied.

    M2 — PARAPHRASE GATE (IELTS/TOEFL critical)
    ${difficulty === 'A2'
      ? 'A2 override: correct answers may use wording close to the passage because recognition is part of the task.'
      : difficulty === 'B1'
        ? 'B1 override: light paraphrase is preferred, but options must remain simple and clear.'
        : 'B2/C1: correct answers should paraphrase the passage; C1 uses the strictest paraphrase gate.'}
    ${difficulty === 'A2' ? 'For A2, correct answers may repeat short, simple wording from the passage.' : 'The CORRECT answer MUST use different wording than the passage.'}
    If an option repeats passage wording verbatim, it is likely a TRAP.
    Only Vocabulary in Context and Evidence quotes are exempt.

    M3 — SOPHISTICATED DISTRACTORS (SAT gold standard)
    Every wrong option must reflect a SPECIFIC misreading pattern:
    • "True but not answering THIS question" (confuses related ideas)
    • "True for wrong part of passage" (paragraph scope error)
    • "Reasonable inference from insufficient evidence" (over-reaching)
    • "Opposite or reversed relationship" (cause↔effect swap)
    • "Stronger/weaker claim than passage supports" (intensity error)
    • "Real-world true but passage false" (outside knowledge trap)

    M4 — RHETORICAL AWARENESS (TOEFL/SAT emphasis)
    Questions must assess understanding of WHY the author writes,
    not just WHAT the author writes. Ask about purpose, function, strategy.

    ╔══════════════════════════════════════════════════════════════╗
    ║  FEW-SHOT EXAMPLES — Match this quality exactly            ║
    ╚══════════════════════════════════════════════════════════════╝
    ${buildMCExamples(difficulty)}

    ╔══════════════════════════════════════════════════════════════╗
    ║  DIFFICULTY GRADIENT — ${profile.label}                  ║
    ╚══════════════════════════════════════════════════════════════╝
    - Inference steps: ${profile.mcQuestions.inferenceSteps[0]}-${profile.mcQuestions.inferenceSteps[1]} per question
    - Distractor quality: ${profile.mcQuestions.distractorPlausibility}
    - Paraphrase: ${profile.mcQuestions.paraphraseStrict ? 'STRICT — correct answer must NEVER reuse passage wording verbatim' : profile.mcQuestions.paraphraseRequired ? 'Required — correct answer uses different wording than passage' : 'May use similar wording'}
    ${profile.mcQuestions.counterfactualRequired ? '- COUNTERFACTUAL REQUIRED: At least 1 question must use "If X had not happened, then Y..." reasoning' : ''}
    ${profile.mcQuestions.vocabLevel ? `- Vocabulary target: ${profile.mcQuestions.vocabLevel}` : ''}
    ${profile.mcQuestions.minInferenceSteps ? `- Each Inference question: minimum ${profile.mcQuestions.minInferenceSteps} reasoning steps` : ''}

    ╔══════════════════════════════════════════════════════════════╗
    ║  QUESTION REQUIREMENTS                                      ║
    ╚══════════════════════════════════════════════════════════════╝

    ${buildLevelMCBlueprint(difficulty)}

    LEGACY TYPE DISTRIBUTION TABLE (REFERENCE ONLY):
    The level-specific blueprint above is authoritative. Do not override it with this older generic table.
    ┌──────────────────────────────┬────────┬──────────────────────────┐
    │ Type                         │ Count  │ Core Exam Skill           │
    ├──────────────────────────────┼────────┼──────────────────────────┤
    │ Main Idea                    │   1    │ Central claim recognition │
    │ Literal Comprehension        │   2    │ Stated fact location     │
    │ Inference                    │   3    │ Implicit meaning (IELTS/TOEFL/SAT core) │
    │ Evidence Reasoning           │   2    │ Evidence evaluation (SAT core) │
    │ Vocabulary in Context        │   1    │ Contextual meaning (all 3) │
    │ Structure/Function/Synthesis │   1    │ Rhetorical analysis (TOEFL/SAT) │
    └──────────────────────────────┴────────┴──────────────────────────┘

    CRITICAL RULES (apply to EVERY question):
    1. PARAPHRASE: Correct answer rewrites the passage, never copies verbatim
       (exception: Vocab-in-Context options, Evidence quotes)
    2. DISTRACTORS: Every wrong option must feel PLAUSIBLE to a careful reader.
       Each reflects a specific misreading — never random or absurd.
    3. ELIMINATION: Design so that 3 options can be eliminated by text evidence.
       If you can't eliminate an option with specific text → it might be correct.
    4. DEPTH: Inference questions require ≥2 steps from text to answer.
       Single-step lookups are Literal Comprehension, not Inference.
    5. EVIDENCE PAIR: The evidence question's correct quote must DIRECTLY
       prove the claim question's answer, not just be on the same topic.

    ${profile.mcQuestions.guidance}

    DISTRACTOR TAGGING:
    ┌──────────────────────────┬────────────────────────────────────────────┐
    │ Pattern                  │ When to use                                 │
    ├──────────────────────────┼────────────────────────────────────────────┤
    │ "Too Broad"              │ Statement overstates/extrapolates passage  │
    │ "Too Narrow"             │ True detail presented as the main point    │
    │ "Too Strong"             │ Claim is stronger than the passage allows  │
    │ "Partially True"         │ Mixes correct + incorrect elements         │
    │ "Wrong Scope"            │ Right topic but wrong paragraph/context    │
    │ "Unsupported Inference"  │ Plausible but lacks textual evidence       │
    │ "Reversed Logic"         │ Flips cause↔effect, before↔after, etc.    │
    └──────────────────────────┴────────────────────────────────────────────┘

    COGNITIVE TARGETS (${profile.label}):
    - Retrieval: ${Math.round(profile.mcQuestions.cognitiveRatios.retrieval * 100)}% / Inference: ${Math.round(profile.mcQuestions.cognitiveRatios.inference * 100)}% / Synthesis: ${Math.round(profile.mcQuestions.cognitiveRatios.synthesis * 100)}%
    - Max ${profile.mcQuestions.maxRetrievalQuestions} retrieval Qs / Min ${profile.mcQuestions.minInferenceQuestions} inference Qs / Min ${profile.mcQuestions.minSynthesisQuestions} synthesis Qs

    MECHANICAL:
    - Options raw text. No prefixes. Lengths within ~30%.
    - Answer = single letter A/B/C/D.
    - Correct answers: 2-3 per letter.
    - Every question: explanation + cognitiveLevel + distractors.
    - C1 only: every Inference and Structure / Function / Synthesis question must also include evidence[] and reasoningSteps[].

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
    □ ${difficulty === 'A2' || difficulty === 'B1' ? 'No evidence pair required at this level' : 'Exactly 1 evidence pair (claim Q + evidence Q, explicitly linked)'}
    □ ${difficulty === 'A2' ? 'At most 1 very simple structure/function question' : 'At least 1 structure/function question'}
    □ ${difficulty === 'A2' ? 'No transfer/synthesis question required' : 'At least 1 transfer/synthesis question (answer not in passage)'}
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
    For C1, do not use the Literal Comprehension example below; follow the C1 blueprint and include evidence[] and reasoningSteps[] where required.
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

function extractMessageContent(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function assertWorksheetLike(parsed: any, provider: AIProvider, modelName: string): WorksheetData {
  const hasWorksheetShape =
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (
      typeof parsed.title === 'string' ||
      typeof parsed.articleSnippet === 'string' ||
      parsed.summary ||
      Array.isArray(parsed.multipleChoice) ||
      Array.isArray(parsed.syntaxDeconstruction) ||
      parsed.writingWorkshop
    );

  if (!hasWorksheetShape) {
    throw new Error(
      `AI returned an empty or non-worksheet JSON object from ${provider}/${modelName}. ` +
      `Please retry, or switch to DeepSeek V4 Pro if Flash keeps returning empty output.`
    );
  }

  return parsed as WorksheetData;
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
  deepseek: 'https://api.deepseek.com',
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

const callOpenAICompatibleJSON = async (
  prompt: string,
  modelName: string,
  apiKey: string,
  provider: AIProvider,
  baseUrl?: string
): Promise<any> => {
  const resolvedBase = getBaseUrl(provider, baseUrl);
  const url = resolvedBase + '/chat/completions';

  const body: any = {
    model: modelName,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: PROVIDER_MAX_TOKENS[provider] || 8192,
  };

  // DeepSeek V4 Flash can return "{}" under JSON mode for long structured prompts.
  // Keep JSON mode for Pro and other OpenAI-compatible models; only Flash uses
  // prompt-only JSON because its long structured output is less stable.
  if (!(provider === 'deepseek' && modelName === 'deepseek-v4-flash')) {
    body.response_format = { type: 'json_object' };
  }

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
  const message = data.choices?.[0]?.message;
  const content = extractMessageContent(message);
  if (!content.trim()) {
    const switchHint = modelName === 'deepseek-v4-flash'
      ? ' Please retry, or switch to DeepSeek V4 Pro for long worksheet generation.'
      : ' Please retry. If this persists, the provider returned an empty message for this request.';
    throw new Error(
      `API returned empty content from ${provider}/${modelName}.` + switchHint
    );
  }
  const jsonText = extractJSON(content);

  try {
    return JSON.parse(jsonText);
  } catch (parseErr: any) {
    console.error("Failed to parse JSON from API response:", content);
    const trimmed = content.trim();
    if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
      throw new Error(`AI response was truncated (incomplete JSON). The model ran out of output tokens. Try a shorter article or a model with a larger context window.`);
    }
    throw new Error(`Failed to parse API response: ${parseErr.message}`);
  }
};

const callOpenAICompatible = async (
  prompt: string,
  modelName: string,
  apiKey: string,
  provider: AIProvider,
  baseUrl?: string
): Promise<WorksheetData> => {
  const parsed = await callOpenAICompatibleJSON(prompt, modelName, apiKey, provider, baseUrl);
  return assertWorksheetLike(parsed, provider, modelName);
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

async function callJSON(prompt: string, aiConfig: AIConfig): Promise<any> {
  switch (aiConfig.provider) {
    case 'deepseek':
    case 'kimi':
    case 'custom':
      return callOpenAICompatibleJSON(prompt, aiConfig.model, aiConfig.apiKey, aiConfig.provider, aiConfig.baseUrl);
    default:
      return callAI(prompt, aiConfig);
  }
}

function buildSectionPromptHeader(article: string, difficulty: Difficulty, sectionName: string): string {
  const profile = getDifficultyProfile(difficulty);
  return `
You are generating ONE SECTION of an ESL reading worksheet.
Section: ${sectionName}
Level: ${profile.label}

Rules:
- Return ONLY valid JSON. No markdown fences, no comments.
- Do not include fields outside the requested schema.
- All content must be based on the article.
- Use the exact field names shown.

Article:
${article}
`;
}

function buildSummarySectionPrompt(article: string, difficulty: Difficulty): string {
  const profile = getDifficultyProfile(difficulty);
  return `
${buildSectionPromptHeader(article, difficulty, 'Title, article snippet, and summary completion')}

Create:
1. A concise worksheet title.
2. articleSnippet: about 150-220 words copied verbatim from the beginning or core of the article.
3. summary: one paragraph with EXACTLY five [BLANK] tokens.
4. summary.blanks: EXACTLY five answers, each answer must appear verbatim in the article.

Difficulty guidance:
- Summary blank max words: ${profile.summary.maxBlankWords}
- Paraphrase degree: ${profile.summary.paraphraseDegree}
- ${profile.summary.guidance}

JSON schema:
{
  "title": "Worksheet title",
  "articleSnippet": "verbatim article excerpt",
  "summary": {
    "paragraph": "Summary sentence with [BLANK] ... exactly five blanks total.",
    "blanks": ["answer1", "answer2", "answer3", "answer4", "answer5"]
  }
}
`;
}

function buildMCBatchPrompt(article: string, difficulty: Difficulty, start: number, end: number): string {
  const profile = getDifficultyProfile(difficulty);
  return `
${buildSectionPromptHeader(article, difficulty, `Multiple choice questions q${start}-q${end}`)}

Generate ONLY questions q${start} through q${end}. Do not generate other question ids.

Authoritative slot blueprint:
${buildLevelMCBlueprint(difficulty)}

Quality rules:
- ${profile.mcQuestions.guidance}
- Correct answers must be text-supported and paraphrased unless the slot is Vocabulary in Context or Evidence Reasoning quotes.
- Every question needs: id, type, cognitiveLevel, question, options, answer, explanation, distractors.
- options must be an array of exactly four raw option texts. No A/B/C/D prefixes.
- answer must be one letter: A, B, C, or D.
- distractors must include metadata for wrong options only.
- Allowed distractor patterns: Too Broad, Too Narrow, Too Strong, Partially True, Wrong Scope, Unsupported Inference, Reversed Logic.
- For C1 Inference and Structure / Function / Synthesis questions, include evidence[] with at least 2 references and reasoningSteps[] with at least 2 steps.
- For C1 Vocabulary in Context, do not use the stem "In paragraph X, the word...". Use an analytical stem such as "The author's use of 'X' primarily frames..." or "Within the argument, 'X' most nearly conveys...".
- For Evidence Reasoning pairs, include matching evidencePairLink fields.
- For evidence quote questions, options should be short verbatim quotations from the article.
- Keep explanations and distractor rationales concise: 1 sentence each.
- Keep evidence references short: paragraph/sentence labels or short quoted fragments, not long copied passages.

JSON schema:
{
  "multipleChoice": [
    {
      "id": "q${start}",
      "type": "Main Idea",
      "cognitiveLevel": "retrieval",
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "answer": "A",
      "explanation": "...",
      "distractors": {
        "B": { "pattern": "Too Broad", "rationale": "..." },
        "C": { "pattern": "Wrong Scope", "rationale": "..." },
        "D": { "pattern": "Unsupported Inference", "rationale": "..." }
      },
      "evidence": ["optional for C1 inference/synthesis"],
      "reasoningSteps": ["optional for C1 inference/synthesis"],
      "evidencePairLink": { "claimQuestionId": "q4", "evidenceQuestionId": "q5" }
    }
  ]
}
`;
}

function buildSyntaxSectionPrompt(article: string, difficulty: Difficulty): string {
  const profile = getDifficultyProfile(difficulty);
  return `
${buildSectionPromptHeader(article, difficulty, 'Syntax deconstruction')}

Create EXACTLY 2 syntax deconstruction items.
- ${profile.syntax.guidance}
- Choose sentences with high grammar learning value, not merely long sentences.
- original must be copied verbatim from the article.
- answer should decompose the sentence into simple clauses and label clause types.
- Target sentence word range: ${profile.syntax.sentenceWordRange[0]}-${profile.syntax.sentenceWordRange[1]} words.
- Target clause types: ${profile.syntax.targetClauseTypes.join(', ')}.
- Decomposition detail: ${profile.syntax.decompositionDetail}.

JSON schema:
{
  "syntaxDeconstruction": [
    { "id": "s1", "original": "Exact sentence from article.", "answer": "Clause-by-clause decomposition." },
    { "id": "s2", "original": "Exact sentence from article.", "answer": "Clause-by-clause decomposition." }
  ]
}
`;
}

function buildWritingSectionPrompt(article: string, difficulty: Difficulty, options: GenerationOptions): string {
  const profile = getDifficultyProfile(difficulty);
  const requested = [
    options.writing_expansion ? 'sentence expansion' : null,
    options.writing_keywords ? 'keyword paragraph' : null,
    options.writing_qa ? 'Q&A chain' : null,
    options.writing_critical ? 'critical perspective' : null,
  ].filter(Boolean).join(', ');
  return `
${buildSectionPromptHeader(article, difficulty, 'Writing and logic workshop')}

Create ONLY these writing parts: ${requested}.
Do not spend output tokens on unrequested writing parts; return empty arrays/strings for them.

Requested part rules:
${options.writing_expansion ? '- expansion: EXACTLY 4 items. Each fact must be based on the article. Give 2-3 level-appropriate conjunctions and a sampleAnswer. Also return keys.expansion.' : '- expansion: return [] and keys.expansion: [].'}
${options.writing_keywords ? '- keywords: EXACTLY 5 core words or short phrases that appear verbatim in the article.' : '- keywords: return [].'}
${options.writing_qa ? `- qaChain: EXACTLY 4 open-ended questions at ${profile.writing.qaComplexity} level. Also return keys.qa.` : '- qaChain: return [] and keys.qa: [].'}
${options.writing_critical ? `- criticalThinking: ONE ${profile.writing.criticalThinkingType} prompt. Also return keys.critical.` : '- criticalThinking: return "" and keys.critical: "".'}

Writing guidance:
- ${profile.writing.guidance}
- Expected writing output: ${profile.writing.expectedWritingOutput}
- Suggested conjunctions: ${profile.writing.conjunctionExamples.join(', ')}

JSON schema:
{
  "writingWorkshop": {
    "expansion": [
      { "id": "e1", "fact": "...", "conjunctions": ["however", "therefore"], "sampleAnswer": "..." }
    ],
    "keywords": ["...", "...", "...", "...", "..."],
    "qaChain": ["Question 1?", "Question 2?", "Question 3?", "Question 4?"],
    "criticalThinking": "..."
  },
  "keys": {
    "expansion": ["...", "...", "...", "..."],
    "qa": ["...", "...", "...", "..."],
    "critical": "..."
  }
}
`;
}

function ensureArray<T>(value: T[] | undefined, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`AI section response missing array: ${label}`);
  }
  return value;
}

async function generateJSONSection(
  label: string,
  prompt: string,
  aiConfig: AIConfig,
  onProgress?: (message: string) => void,
): Promise<any> {
  onProgress?.(label);
  return withRetry(() => callJSON(prompt, aiConfig));
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function generateSectionedWorksheet(
  article: string,
  difficulty: Difficulty,
  aiConfig: AIConfig,
  onProgress?: (message: string) => void,
  generationOptions: GenerationOptions = DEFAULT_GENERATION_OPTIONS,
): Promise<WorksheetData> {
  const options = { ...DEFAULT_GENERATION_OPTIONS, ...generationOptions };
  const selectedWriting = options.writing_expansion || options.writing_keywords || options.writing_qa || options.writing_critical;
  const selectedTasks = [
    options.summary ? 'summary' : null,
    options.mc ? 'questions' : null,
    options.syntaxDeconstruction ? 'syntax' : null,
    selectedWriting ? 'writing' : null,
  ].filter(Boolean);
  let completedTasks = 0;
  const mark = (label: string) => {
    onProgress?.(`${label} (${Math.min(completedTasks + 1, selectedTasks.length)}/${selectedTasks.length})...`);
  };

  const summaryPromise = options.summary
    ? generateJSONSection('Generating summary', buildSummarySectionPrompt(article, difficulty), aiConfig, mark)
    : Promise.resolve({});

  const mcGroups = [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 5],
    [6, 6],
    [7, 7],
    [8, 8],
    [9, 9],
    [10, 10],
  ] as const;

  const mcPromise = options.mc
    ? runWithConcurrency(mcGroups, 3, async ([start, end]) => {
        const label = start === end
          ? `Generating question ${start}`
          : `Generating questions ${start}-${end}`;
        return generateJSONSection(label, buildMCBatchPrompt(article, difficulty, start, end), aiConfig, onProgress);
      }).then(parts => {
        completedTasks++;
        onProgress?.(`Questions complete (${completedTasks}/${selectedTasks.length})...`);
        return parts;
      })
    : Promise.resolve([]);

  const syntaxPromise = options.syntaxDeconstruction
    ? generateJSONSection('Generating syntax section', buildSyntaxSectionPrompt(article, difficulty), aiConfig, mark)
        .then(part => {
          completedTasks++;
          onProgress?.(`Syntax complete (${completedTasks}/${selectedTasks.length})...`);
          return part;
        })
    : Promise.resolve({});

  const writingPromise = selectedWriting
    ? generateJSONSection('Generating writing section', buildWritingSectionPrompt(article, difficulty, options), aiConfig, mark)
        .then(part => {
          completedTasks++;
          onProgress?.(`Writing complete (${completedTasks}/${selectedTasks.length})...`);
          return part;
        })
    : Promise.resolve({});

  const summaryPart = await summaryPromise.then(part => {
    if (options.summary) {
      completedTasks++;
      onProgress?.(`Summary complete (${completedTasks}/${selectedTasks.length})...`);
    }
    return part;
  });
  const [mcParts, syntaxPart, writingPart] = await Promise.all([mcPromise, syntaxPromise, writingPromise]);

  onProgress?.('Assembling worksheet...');

  const multipleChoice = [
    ...mcParts.flatMap((part: any, index: number) => ensureArray(part.multipleChoice, `multipleChoice group ${index + 1}`)),
  ].sort((a, b) => {
    const aNum = Number(String(a.id || '').replace(/\D/g, '')) || 0;
    const bNum = Number(String(b.id || '').replace(/\D/g, '')) || 0;
    return aNum - bNum;
  });

  const syntaxDeconstruction = options.syntaxDeconstruction
    ? ensureArray(syntaxPart.syntaxDeconstruction, 'syntaxDeconstruction')
    : [];
  const expansion = options.writing_expansion
    ? ensureArray(writingPart.writingWorkshop?.expansion, 'writingWorkshop.expansion')
    : [];
  const keywords = options.writing_keywords
    ? ensureArray(writingPart.writingWorkshop?.keywords, 'writingWorkshop.keywords')
    : [];
  const qaChain = options.writing_qa
    ? ensureArray(writingPart.writingWorkshop?.qaChain, 'writingWorkshop.qaChain')
    : [];

  return {
    title: summaryPart.title || 'Untitled Worksheet',
    articleSnippet: summaryPart.articleSnippet || article.slice(0, 900),
    header: {
      brand: 'OTIA',
      nameLabel: 'Name',
      scoreLabel: 'Score',
    },
    summary: {
      paragraph: summaryPart.summary?.paragraph || '',
      blanks: Array.isArray(summaryPart.summary?.blanks) ? summaryPart.summary.blanks : [],
    },
    multipleChoice,
    syntaxDeconstruction,
    writingWorkshop: {
      expansion,
      keywords,
      qaChain,
      criticalThinking: options.writing_critical ? (writingPart.writingWorkshop?.criticalThinking || '') : '',
    },
    keys: {
      summary: Array.isArray(summaryPart.summary?.blanks) ? summaryPart.summary.blanks : [],
      mc: multipleChoice.reduce((acc: Record<string, string>, q: any) => {
        if (q.id && q.answer) acc[q.id] = q.answer;
        return acc;
      }, {}),
      syntaxDeconstruction: syntaxDeconstruction.map((item: any) => item.answer || ''),
      expansion: Array.isArray(writingPart.keys?.expansion)
        ? writingPart.keys.expansion
        : expansion.map((item: any) => item.sampleAnswer || ''),
      qa: Array.isArray(writingPart.keys?.qa) ? writingPart.keys.qa : [],
      critical: options.writing_critical ? (writingPart.keys?.critical || '') : '',
    },
  };
}

// ==================== Refinement (self-correction) ====================

const MAX_REFINEMENT_ROUNDS = 0; // No API refinement — rely on prompt quality + mechanical auto-fixes

const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  summary: true,
  mc: true,
  syntaxDeconstruction: true,
  writing_expansion: true,
  writing_keywords: true,
  writing_qa: true,
  writing_critical: true,
};

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
  onProgress?: (message: string) => void,
  generationOptions: GenerationOptions = DEFAULT_GENERATION_OPTIONS,
): Promise<{ data: WorksheetData; rounds: number; reports: RefinementReport[] }> {
  const aiConfig = getActiveConfig();
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('No active AI provider configured. Please set up your API key in Settings.');
  }

  const reports: RefinementReport[] = [];

  // --- Initial generation ---
  let data = aiConfig.provider === 'deepseek'
    ? await generateSectionedWorksheet(article, difficulty, aiConfig, onProgress, generationOptions)
    : await withRetry(() => callAI(buildPrompt(article, difficulty), aiConfig));
  let rounds = 0;

  // Dynamic import to avoid circular dependency
  const { validateAll } = await import('../validators');

  for (let r = 0; r < MAX_REFINEMENT_ROUNDS; r++) {
    const { issues: beforeIssues, fixedData } = validateAll(data, article, difficulty);
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
    const { issues: afterIssues, fixedData: afterFixed } = validateAll(data, article, difficulty);
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
