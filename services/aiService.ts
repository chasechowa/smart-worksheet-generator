import { WorksheetData, Difficulty, AIConfig, AIProvider, ValidationIssue, IssueGroup, RefinementReport, GenerationOptions, MCQuestion, MCQuestionType, SyntaxDeconstructionItem, ExpansionItem, SentenceInsertionQuestion } from "../types";
import { getActiveConfig } from "./configService";
import { getDifficultyProfile } from "./difficultyProfiles";
import { normalizeInsertionMarkers, normalizeInsertionAnswer, EXPECTED_INSERTION_COUNT } from "../validators/sentenceInsertionValidator";
import {
  OPTION_LENGTH_TOLERANCE_WORDS,
  getOptionLengthViolations,
  stripPrefix,
  normalizeAnswerToken,
  B2_MC_SLOT_RULES,
  B2_REASONING_SLOTS,
  B2_Q2_TRIVIA_STEM,
  getB2SlotNumber,
  canonicalMCQuestionType,
  canonicalCognitiveLevel,
  canonicalMCScope,
} from "../validators/mcValidator";

// CF Worker proxy URLs — tried in order. The Worker buffers the upstream
// response, so the browser timeout must allow a full worksheet section to be
// generated rather than only covering connection setup.
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

const PROXY_REQUEST_TIMEOUT_MS = 120_000;

export async function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  // 构建代理列表：用户自定义 + 默认
  const proxies: string[] = [];
  const userProxy = getUserProxy();
  if (userProxy) proxies.push(userProxy);
  proxies.push(...DEFAULT_PROXIES);

  // 浏览器 → Worker 代理
  let lastError: string | null = null;
  for (const proxyUrl of proxies) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROXY_REQUEST_TIMEOUT_MS);

      const proxyHeaders: Record<string, string> = {
        'X-Target-URL': url,
        'Content-Type': 'application/json',
      };

      if (options?.headers) {
        const h = options.headers as Record<string, string>;
        if (h['Authorization']) proxyHeaders['Authorization'] = h['Authorization'];
        if (h['Content-Type']) proxyHeaders['Content-Type'] = h['Content-Type'];
      }

      let resp: Response;
      try {
        resp = await fetch(proxyUrl, {
          method: options?.method || 'POST',
          headers: proxyHeaders,
          body: options?.body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (resp.ok || resp.status >= 400) {
        return resp;
      }
      lastError = `Proxy returned ${resp.status}`;
    } catch (err: any) {
      lastError = err.name === 'AbortError'
        ? `Proxy ${proxyUrl} timed out after ${PROXY_REQUEST_TIMEOUT_MS / 1000}s`
        : err.message;
      continue;
    }
  }

  // Final fallback: direct request. DeepSeek/Kimi may work directly depending on network and CORS.
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
    - Q2 Literal Comprehension, cognitiveLevel: retrieval. Ask for the ONE central stated fact that best supports the argument — never a statistic, percentage, date, name, or isolated number.
    - Q3 Inference, cognitiveLevel: inference. Test hidden meaning within one paragraph; the answer must not be stated verbatim.
    - Q4 Inference, cognitiveLevel: inference. Require connecting evidence from two different parts of the article.
    - Q5 Inference, cognitiveLevel: synthesis. Test an unstated assumption, limitation, or likely consequence.
    - Q6 Evidence Reasoning, cognitiveLevel: inference. Claim question; link it to Q7 with evidencePairLink.
    - Q7 Evidence Reasoning, cognitiveLevel: inference. Evidence question for Q6; options must be short verbatim quotations of similar length; the three wrong quotations must support a different claim or be true but irrelevant, never the same claim.
    - Q8 Structure / Function / Synthesis, cognitiveLevel: synthesis. ALWAYS test the author's attitude, tone, stance, or a change in stance: quote or name at least one specific wording signal in the stem and ask what it reveals about the stance.
    - Q9 Vocabulary in Context, cognitiveLevel: inference. Target a B2 academic/polysemous word or phrase.
    - Q10 Structure / Function / Synthesis, cognitiveLevel: synthesis. Test author purpose, paragraph function, argumentative structure, or why evidence is included.

    B2 BOUNDARIES:
    - Exactly 1 direct retrieval question (Q2); no standalone trivia such as "Which company...", dates, names, or isolated numbers.
    - Q1, Q4, Q5, Q8, and Q10 must require whole-text or cross-paragraph understanding.
    - The evidence pair must directly prove a claim, not merely mention the same topic.
    - Distractors should be plausible text-based misreadings, not obviously false choices.
    - Avoid C1-only demands such as 3-step abstract critique or C1/C2 vocabulary options.
`;
  }

  return `
    C1 QUESTION BLUEPRINT (EXACT - FOLLOW THESE 10 SLOTS; THIS OVERRIDES THE NON-C1 TABLE BELOW):
    - Q1 Main Idea, cognitiveLevel: synthesis. Test the central thesis without reusing the article's wording.
    - Q2 Inference, cognitiveLevel: synthesis. Require cross-paragraph synthesis; no single sentence may answer it.
    - Q3 Inference, cognitiveLevel: inference. Ask about an unstated implication, limitation, or tension in the author's argument.
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

function extractOpenAIChoiceContent(data: any): string {
  const choice = data?.choices?.[0];
  const messageContent = extractMessageContent(choice?.message);
  if (messageContent.trim()) return messageContent;
  if (typeof choice?.text === 'string') return choice.text;
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

// ==================== OpenAI-Compatible Provider ====================

const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  kimi: 'https://api.moonshot.cn/v1',
};

const PROVIDER_MAX_TOKENS: Record<string, number> = {
  // DeepSeek V4 supports substantially larger outputs. 8K was too small for
  // detailed worksheet JSON and caused finish_reason=length with empty content.
  deepseek: 32768,
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
  baseUrl?: string,
  maxTokensOverride?: number,
): Promise<any> => {
  const resolvedBase = getBaseUrl(provider, baseUrl);
  const url = resolvedBase + '/chat/completions';
  const maxTokens = maxTokensOverride || PROVIDER_MAX_TOKENS[provider] || 8192;
  const attempts = provider === 'deepseek'
    ? [
        { label: 'json_mode', responseFormat: true, temperature: 0.2, maxTokens },
        { label: 'plain_json', responseFormat: false, temperature: 0.2, maxTokens: Math.max(maxTokens, 49152) },
        { label: 'plain_json_low_temp', responseFormat: false, temperature: 0.1, maxTokens: Math.max(maxTokens, 65536) },
      ]
    : [
        { label: 'json_mode', responseFormat: true, temperature: 0.5, maxTokens },
      ];
  let lastError: Error | null = null;

  for (const attempt of attempts) {
    const body: any = {
      model: modelName,
      messages: [
        { role: 'system', content: 'Return exactly one valid JSON object. Do not include markdown, prose, or code fences.' },
        { role: 'user', content: prompt },
      ],
      temperature: attempt.temperature,
      max_tokens: attempt.maxTokens,
    };

    if (attempt.responseFormat) {
      body.response_format = { type: 'json_object' };
    }
    if (provider === 'deepseek') {
      // V4 defaults to thinking mode. Structured worksheet generation is more
      // reliable and considerably faster in non-thinking mode.
      body.thinking = { type: 'disabled' };
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
      console.error(`API Error ${response.status} from ${provider}/${modelName} (${attempt.label}):`, errorBody);
      if (response.status === 401 || response.status === 403) {
        throw new Error(`API key invalid or unauthorized (${response.status}). Please check your API key.`);
      }
      if (response.status === 402) {
        throw new Error(`Insufficient balance (${response.status}). Your API account has no remaining credit.`);
      }
      if (response.status === 429) {
        throw new Error(`Rate limit exceeded (${response.status}). Please try again later.`);
      }
      lastError = new Error(`API Error ${response.status}: ${errorBody}`);
      if (provider === 'deepseek' && attempt.responseFormat && response.status === 400) {
        continue;
      }
      throw lastError;
    }

    const data = await response.json();
    const content = extractOpenAIChoiceContent(data);
    if (!content.trim()) {
      const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
      lastError = new Error(
        `API returned empty content from selected model ${provider}/${modelName} (${attempt.label}, finish_reason: ${finishReason}).`
      );
      console.warn(lastError.message);
      // A length stop is recoverable: the following DeepSeek attempt receives
      // a progressively larger output budget.
      continue;
    }

    const jsonText = extractJSON(content);
    try {
      return JSON.parse(jsonText);
    } catch (parseErr: any) {
      console.error(`Failed to parse JSON from API response (${attempt.label}):`, content);
      const trimmed = content.trim();
      if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
        throw new Error(`AI response was truncated (incomplete JSON). The selected model ${provider}/${modelName} ran out of output tokens. Try fewer sections or a shorter article.`);
      }
      lastError = new Error(`Failed to parse API response from selected model ${provider}/${modelName}: ${parseErr.message}`);
    }
  }

  throw lastError || new Error(`API returned no usable JSON from selected model ${provider}/${modelName}.`);
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
    case 'deepseek':
    case 'kimi':
    case 'custom':
      return callOpenAICompatible(prompt, aiConfig.model, aiConfig.apiKey, aiConfig.provider, aiConfig.baseUrl);
    default:
      throw new Error(`Unsupported provider: ${aiConfig.provider}`);
  }
}

async function callJSON(prompt: string, aiConfig: AIConfig, maxTokensOverride?: number): Promise<any> {
  switch (aiConfig.provider) {
    case 'deepseek':
    case 'kimi':
    case 'custom':
      return callOpenAICompatibleJSON(prompt, aiConfig.model, aiConfig.apiKey, aiConfig.provider, aiConfig.baseUrl, maxTokensOverride);
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

function buildSummarySectionPrompt(article: string, difficulty: Difficulty, analysis?: ArticleAnalysisMap | null): string {
  const profile = getDifficultyProfile(difficulty);
  return `
${buildSectionPromptHeader(article, difficulty, 'Title, article snippet, and summary completion')}
${formatAnalysisMap(analysis)}

Create:
1. A concise worksheet title.
2. articleSnippet: about 150-220 words copied verbatim from the beginning or core of the article.
3. summary.paragraph: ONE coherent paragraph summarizing the article. It MUST contain inline [BLANK] markers. A [BLANK] is the literal text [BLANK] (both square brackets + the word BLANK). Each [BLANK] replaces exactly one answer phrase from the article.
4. summary.blanks: an array of answer strings, in the SAME left-to-right order as the [BLANK] markers. blanks[i] is the exact phrase you removed from the paragraph to create the i-th [BLANK].
${difficulty === 'B2' ? `5. summary.blankTargets: EXACTLY five objects, aligned with summary.blanks, using each role exactly once:
   central-concept, cause-or-mechanism, key-development, contrast-or-limitation, result-or-conclusion.
   Each object contains answer, role, and sourceArea. Use at least three different sourceArea labels.` : ''}

CRITICAL RULES for summary:
- Use the literal token [BLANK] — do NOT use underscores (____), parentheses, or a chevron. Never number the blanks (no [BLANK1], no "blank 1").
- Choose a specific high-value phrase from the article for each blank, then remove that phrase from the paragraph and put [BLANK] exactly where it was. Blanks must be verbatim extracts from the article (per the word-count guidance below).
- The paragraph must read naturally with the blanks; blanks[i] must be the exact text that was replaced.
${difficulty === 'B2' ? `- Cover the article's whole argument, not only its opening. The five blanks must test five different information functions.
- Draw answers from at least three different paragraphs or widely separated information regions.
- Put no more than two [BLANK] tokens in one sentence.` : ''}

Example of the required style:
  "paragraph": "[BLANK] improves memory, while [BLANK] reduces focus. Researchers also connect [BLANK] with learning, [BLANK] with recovery, and [BLANK] with performance.",
  "blanks": ["answer1", "answer2", "answer3", "answer4", "answer5"]

BEFORE RETURNING: count the [BLANK] tokens inside summary.paragraph. There MUST be EXACTLY 5 tokens and EXACTLY 5 entries in summary.blanks (one [BLANK] per answer, no more, no fewer). If either count is not 5, fix it before returning.

Difficulty guidance:
- Summary blank max words: ${profile.summary.maxBlankWords}
- Paraphrase degree: ${profile.summary.paraphraseDegree}
- ${profile.summary.guidance}

JSON schema:
{
  "title": "Worksheet title",
  "articleSnippet": "verbatim article excerpt",
  "summary": {
    "paragraph": "Summary sentence with [BLANK] ... one [BLANK] per answer, in order.",
    "blanks": ["answer1", "answer2", "answer3", "answer4", "answer5"]${difficulty === 'B2' ? `,
    "blankTargets": [
      { "answer": "answer1", "role": "central-concept", "sourceArea": "P1" },
      { "answer": "answer2", "role": "cause-or-mechanism", "sourceArea": "P2" },
      { "answer": "answer3", "role": "key-development", "sourceArea": "P3" },
      { "answer": "answer4", "role": "contrast-or-limitation", "sourceArea": "P4" },
      { "answer": "answer5", "role": "result-or-conclusion", "sourceArea": "P5" }
    ]` : ''}
  }
}
`;
}

// DeepSeek sometimes writes a coherent summary but omits the [BLANK] markers
// (or leaves some answers un-blanked). This repair reconciles the paragraph
// with the answer list: it injects each answer verbatim into the paragraph as
// [BLANK], then trims the answer list to the final [BLANK] count so the
// summary, blanks, and keys always line up.
export function repairSummary(input: { paragraph: string; blanks: string[] }): { paragraph: string; blanks: string[] } {
  let paragraph = (input.paragraph || '').replace(/\[BLANK\d*\]/gi, '[BLANK]');
  const blanks = (Array.isArray(input.blanks) ? input.blanks : [])
    .map(b => (typeof b === 'string' ? b.trim() : ''))
    .filter(Boolean);

  let blankCount = (paragraph.match(/\[BLANK\]/g) || []).length;

  // Inject missing answers verbatim into the paragraph until counts line up.
  while (blankCount < blanks.length) {
    const answer = blanks[blankCount];
    if (!answer) break;
    const idx = paragraph.indexOf(answer);
    if (idx === -1) break; // answer not present verbatim; can't safely place it
    paragraph = paragraph.slice(0, idx) + '[BLANK]' + paragraph.slice(idx + answer.length);
    blankCount++;
  }

  // Drop any answers we could not place so keys/blanks match the paragraph.
  return { paragraph, blanks: blankCount < blanks.length ? blanks.slice(0, blankCount) : blanks };
}

const SUMMARY_STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with','as','by','from','into',
  'that','this','these','those','is','are','was','were','be','been','being','it','its','their',
  'they','them','we','our','you','your','he','she','his','her','who','which','when','where','why',
  'than','then','so','such','not','no','also','can','could','may','might','will','would','should',
  'has','have','had','do','does','did','more','most','many','much','some','any','all','both','each',
  'other','others','one','two','first','second','about','because','while','during','between','over',
]);

/**
 * Deterministically guarantee exactly `target` blanks. Expects an already
 * repaired summary (paragraph [BLANK] count === blanks.length). If the model
 * produced fewer than `target`, it tops up by blanking additional phrases that
 * appear verbatim in the article — longest phrases first, then single content
 * words — keeping every blank distinct and within maxBlankWords.
 */
export function ensureFiveBlanks(
  paragraph: string,
  blanks: string[],
  article: string,
  maxBlankWords: number,
  target = 5,
): { paragraph: string; blanks: string[] } {
  const text = (paragraph || '').replace(/\[BLANK\d*\]/gi, '[BLANK]');
  const existing = (Array.isArray(blanks) ? blanks : []).map(b => String(b ?? '').trim()).filter(Boolean);

  // Pair every [BLANK] token with its answer, in paragraph order.
  const entries: Array<{ index: number; length: number; answer: string }> = [];
  {
    const re = /\[BLANK\]/g;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = re.exec(text)) !== null) {
      const answer = existing[i++];
      if (answer) entries.push({ index: match.index, length: '[BLANK]'.length, answer });
    }
  }

  if (entries.length >= target) {
    return { paragraph: text, blanks: entries.map(entry => entry.answer) };
  }

  const normalizedArticle = article.toLocaleLowerCase().replace(/\s+/g, ' ');
  const used = new Set(entries.map(entry => entry.answer.toLocaleLowerCase().replace(/\s+/g, ' ').trim()));
  const taken: Array<[number, number]> = entries.map(entry => [entry.index, entry.index + entry.length]);
  const filler: typeof entries = [];
  const needed = target - entries.length;

  const words = [...text.matchAll(/[A-Za-z][A-Za-z'-]*/g)].map(m => ({ word: m[0], index: m.index as number }));
  const collides = (start: number, end: number) =>
    taken.some(([s, e]) => start < e && end > s) ||
    filler.some(item => start < item.index + item.length && end > item.index);

  for (let n = Math.max(1, maxBlankWords); n >= 1 && filler.length < needed; n--) {
    for (let i = 0; i + n <= words.length && filler.length < needed; i++) {
      const start = words[i].index;
      const end = words[i + n - 1].index + words[i + n - 1].word.length;
      if (collides(start, end)) continue;
      const phrase = text.slice(start, end).replace(/\s+/g, ' ').trim();
      const key = phrase.toLocaleLowerCase();
      if (!key || used.has(key)) continue;
      const parts = key.split(' ').filter(Boolean);
      if (!parts.some(part => !SUMMARY_STOPWORDS.has(part))) continue; // must carry content
      if (!normalizedArticle.includes(key)) continue;                 // must be verbatim in the article
      filler.push({ index: start, length: phrase.length, answer: phrase });
      used.add(key);
    }
  }

  const all = [...entries, ...filler].sort((a, b) => a.index - b.index);
  let out = '';
  let cursor = 0;
  for (const item of all) {
    out += text.slice(cursor, item.index) + '[BLANK]';
    cursor = item.index + item.length;
  }
  out += text.slice(cursor);
  return { paragraph: out, blanks: all.map(item => item.answer) };
}

/**
 * Best-effort repair for the sentence-insertion response. Never throws: coerces
 * what it can and drops only genuinely unusable items (no sentence, no paragraph,
 * or zero markers). A wrong marker count or unreadable answer is left for the
 * validator to flag rather than being silently discarded.
 */
export function repairSentenceInsertionItems(raw: unknown): SentenceInsertionQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, EXPECTED_INSERTION_COUNT)
    .map((entry, index): SentenceInsertionQuestion | null => {
      if (!entry || typeof entry !== 'object') return null;
      const item = entry as Record<string, unknown>;
      const sentence = typeof item.sentence === 'string' ? item.sentence.trim() : '';
      const paragraph = normalizeInsertionMarkers(typeof item.paragraph === 'string' ? item.paragraph : '').trim();
      if (!sentence || !paragraph.trim()) return null;
      if (!/\[[1-4]\]/.test(paragraph)) return null; // no markers at all -> unusable
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `si${index + 1}`,
        sentence,
        paragraph,
        // 0 is a sentinel: the validator reports it as an invalid position.
        answer: normalizeInsertionAnswer(item.answer) ?? 0,
        explanation: typeof item.explanation === 'string' ? item.explanation.trim() : '',
        ...(typeof item.sourceParagraphRef === 'string' && item.sourceParagraphRef.trim()
          ? { sourceParagraphRef: item.sourceParagraphRef.trim() }
          : {}),
      };
    })
    .filter((item): item is SentenceInsertionQuestion => item !== null);
}

interface ArticleAnalysisMap {
  centralThesis: string;
  paragraphFunctions: Array<{ paragraph: string; function: string }>;
  keyFacts: string[];
  implicitInferences: Array<{ inference: string; evidence: string[] }>;
  logicalRelations: Array<{ relation: string; evidence: string[] }>;
  authorAttitude: { label: string; evidence: string[] };
  evidencePairCandidates: Array<{ claim: string; evidence: string[] }>;
}

function formatAnalysisMap(analysis?: ArticleAnalysisMap | null): string {
  if (!analysis) return '';
  return `\nAUTHORITATIVE ARTICLE MAP (use this to design questions; do not copy it into the worksheet):\n${JSON.stringify(analysis)}\n`;
}

export function isCompleteSummary(
  input: { paragraph: string; blanks: string[] },
  article: string,
  maxBlankWords: number,
  blankTargets?: SummaryBlankTarget[],
): boolean {
  const repaired = repairSummary(input);
  const blankCount = (repaired.paragraph.match(/\[BLANK\]/g) || []).length;
  if (blankCount !== 5 || repaired.blanks.length !== 5) return false;

  const normalizedArticle = article.toLocaleLowerCase().replace(/\s+/g, ' ');
  const normalizedAnswers = repaired.blanks.map(answer => answer.toLocaleLowerCase().replace(/\s+/g, ' ').trim());
  if (new Set(normalizedAnswers).size !== 5) return false;

  const answersValid = normalizedAnswers.every(answer => {
    const wordCount = answer.split(/\s+/).filter(Boolean).length;
    return Boolean(answer) && wordCount <= maxBlankWords && normalizedArticle.includes(answer);
  });
  if (!answersValid) return false;

  if (blankTargets) {
    const requiredRoles = new Set<string>(['central-concept', 'cause-or-mechanism', 'key-development', 'contrast-or-limitation', 'result-or-conclusion']);
    if (blankTargets.length !== 5) return false;
    const roles = new Set<string>(blankTargets.map(target => target.role));
    if (roles.size !== requiredRoles.size || [...requiredRoles].some(role => !roles.has(role))) return false;
    const targetAnswers = blankTargets.map(target => target.answer.toLocaleLowerCase().replace(/\s+/g, ' ').trim());
    if (targetAnswers.some((answer, index) => answer !== normalizedAnswers[index])) return false;
    const sourceAreas = new Set(blankTargets.map(target => target.sourceArea.trim()).filter(Boolean));
    if (sourceAreas.size < 3) return false;
  }

  return true;
}

async function generateCompleteSummarySection(
  article: string,
  difficulty: Difficulty,
  aiConfig: AIConfig,
  onProgress?: (message: string) => void,
  analysis?: ArticleAnalysisMap | null,
): Promise<SummarySectionResponse> {
  const profile = getDifficultyProfile(difficulty);
  const basePrompt = buildSummarySectionPrompt(article, difficulty, analysis);
  let lastResult: SummarySectionResponse | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const correction = attempt === 1
      ? ''
      : `\nRETRY CORRECTION: Your previous summary failed validation. Return exactly five distinct [BLANK] tokens and five non-empty verbatim answers. Count both arrays before responding.`;
    lastResult = await generateJSONSection<SummarySectionResponse>(
      attempt === 1 ? 'Generating summary' : `Regenerating incomplete summary (${attempt}/3)`,
      basePrompt + correction,
      aiConfig,
      onProgress,
    );
    const repaired = repairSummary({
      paragraph: lastResult.summary?.paragraph || '',
      blanks: Array.isArray(lastResult.summary?.blanks) ? lastResult.summary.blanks : [],
    });
    const blankTargets = Array.isArray(lastResult.summary?.blankTargets) ? lastResult.summary.blankTargets : undefined;
    if (isCompleteSummary(repaired, article, profile.summary.maxBlankWords, difficulty === 'B2' ? blankTargets : undefined)) {
      return { ...lastResult, summary: repaired };
    }
  }

  // Best-effort: return the last repaired summary instead of failing the whole
  // generation. repairSummary already reconciles the [BLANK] markers with the
  // answer list, so counts stay consistent; remaining quality issues surface as
  // warnings in the validation panel rather than blocking the worksheet.
  if (lastResult) {
    const repaired = repairSummary({
      paragraph: lastResult.summary?.paragraph || '',
      blanks: Array.isArray(lastResult.summary?.blanks) ? lastResult.summary.blanks : [],
    });
    // Guarantee exactly five blanks: top up mechanically when the model
    // under-delivered, so the worksheet always shows five blanks.
    const filled = ensureFiveBlanks(repaired.paragraph, repaired.blanks, article, profile.summary.maxBlankWords);
    return { ...lastResult, summary: filled };
  }
  throw new Error('Summary generation returned no usable result. Please retry or switch to DeepSeek V4 Pro.');
}

export function buildMCBatchPrompt(article: string, difficulty: Difficulty, start: number, end: number, analysis?: ArticleAnalysisMap | null): string {
  const profile = getDifficultyProfile(difficulty);
  const fullBlueprint = buildLevelMCBlueprint(difficulty);
  const requestedBlueprint = difficulty === 'B2'
    ? fullBlueprint.split('\n').filter(line => {
        const match = line.match(/- Q(\d+)/);
        return !match || (Number(match[1]) >= start && Number(match[1]) <= end);
      }).join('\n')
    : fullBlueprint;
  return `
${buildSectionPromptHeader(article, difficulty, `Multiple choice questions q${start}-q${end}`)}
${formatAnalysisMap(analysis)}

Generate ONLY questions q${start} through q${end}. Do not generate other question ids.

Authoritative slot blueprint:
${requestedBlueprint}

Quality rules:
- ${profile.mcQuestions.guidance}
- Correct answers must be text-supported and paraphrased unless the slot is Vocabulary in Context or Evidence Reasoning quotes.
- Every question needs: id, type, cognitiveLevel, question, options, answer, explanation.
- Every wrong option needs distractor metadata with one permitted misreading pattern and a concise rationale.
- Distractors must be plausible text-based misreadings. Never use absolute or overreaching wording (always, never, only, all, completely, prove, most important) and never an off-topic option the article does not discuss.
- Evidence-question quotations: all four options must be verbatim article quotations of similar length (within 2 words); the three wrong quotations must support a different claim or be true but irrelevant — they must not also support the claim.
- Q8: do not use a generic "What is the author's attitude?" stem; quote or name at least one specific wording signal and ask what it reveals about the author's stance.
- For B2 inference/synthesis items, include evidence[] with at least two short references and reasoningSteps[] with at least two real reasoning steps.
- For every B2 item include skillTarget and scope (single-paragraph, cross-paragraph, or whole-text).
- A B2 item labelled inference must not be answerable by locating one sentence or matching keywords.
- Q8 must explicitly assess author attitude/tone/stance and cite at least two wording signals.
- options must be an array of exactly four raw option texts. No A/B/C/D prefixes.
- answer must be one letter: A, B, C, or D.
- OPTION-LENGTH BALANCE (ALL LEVELS, word count): the correct option and the three distractors must be close in word count. Every wrong option must be within ${OPTION_LENGTH_TOLERANCE_WORDS} words of the correct option — for example, if the correct option has 1 word, every distractor must have 1-${1 + OPTION_LENGTH_TOLERANCE_WORDS} words; if it has 4 words, every distractor must have ${Math.max(1, 4 - OPTION_LENGTH_TOLERANCE_WORDS)}-${4 + OPTION_LENGTH_TOLERANCE_WORDS} words. Do not let the correct answer stand out as the longest option, and never pad a distractor with filler just to reach the length.
- Evidence-quote questions: write four quotations with nearly equal word counts (the correct quotation must not be noticeably longer than the distractors).
- For C1 Inference and Structure / Function / Synthesis questions, include evidence[] with at least 2 references and reasoningSteps[] with at least 2 steps.
- For C1 Vocabulary in Context, do not use the stem "In paragraph X, the word...". Use an analytical stem such as "The author's use of 'X' primarily frames..." or "Within the argument, 'X' most nearly conveys...".
- For Evidence Reasoning pairs, include matching evidencePairLink fields.
- For evidence quote questions, options should be short verbatim quotations from the article.
- Keep explanations concise: 1 sentence each.
- Keep evidence references short: paragraph/sentence labels or short quoted fragments, not long copied passages.
- Before returning JSON, silently count the words in each option of every question. Rewrite any wrong option that differs from the correct option's word count by more than ${OPTION_LENGTH_TOLERANCE_WORDS} words.

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
      "skillTarget": "cross-paragraph inference",
      "scope": "cross-paragraph",
      "evidence": ["Para2: short reference", "Para5: short reference"],
      "reasoningSteps": ["Connect the first detail to the later contrast", "Infer the supported implication"],
      "distractors": { "B": { "pattern": "Too Broad", "rationale": "Overstates the evidence" } },
      "evidencePairLink": { "claimQuestionId": "q4", "evidenceQuestionId": "q5" }
    }
  ]
}
`;
}

function buildFastMCPrompt(article: string, difficulty: Difficulty): string {
  const profile = getDifficultyProfile(difficulty);
  return `
${buildSectionPromptHeader(article, difficulty, 'Logical analysis multiple-choice section')}

Generate the complete Logical Analysis section in ONE compact JSON response.

Required output:
- exactly 10 questions, ids q1 through q10.
- each question has exactly four raw option texts, no A/B/C/D prefixes.
- answer is one letter: A, B, C, or D.
- include type, cognitiveLevel, question, options, answer, explanation.
- include concise distractors for wrong options when possible, but keep them short.

Slot blueprint:
${buildLevelMCBlueprint(difficulty)}

Fast quality rules:
- ${profile.mcQuestions.guidance}
- Prefer inferential stems over "According to..." retrieval stems.
- Keep each stem under 24 words and each option under 22 words when possible.
- Keep option lengths balanced by CHARACTERS: in each question, longest option should be less than 1.5x the shortest and no more than 25 characters longer.
- For non-quote options, aim for 55-95 characters each; if one option is long, make the other three similarly specific.
- For evidence quote options, use four quotations of similar length, ideally 7-14 words each.
- Explanations: max 18 words.
- Distractor rationales: max 10 words.
- For C1, include evidence only as short paragraph labels, e.g. ["Para2", "Para8"].
- Do not generate syntax, summary, writing tasks, answer key prose, markdown, or HTML.

JSON schema:
{
  "multipleChoice": [
    {
      "id": "q1",
      "type": "Main Idea",
      "cognitiveLevel": "inference",
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "answer": "B",
      "explanation": "...",
      "distractors": {
        "A": { "pattern": "Too Narrow", "rationale": "..." },
        "C": { "pattern": "Wrong Scope", "rationale": "..." },
        "D": { "pattern": "Unsupported Inference", "rationale": "..." }
      },
      "evidence": ["Para1", "Para8"]
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

/** Per-level guidance for the sentence-insertion item (sentence length + cohesion signal). */
function buildInsertionLevelGuidance(difficulty: Difficulty): string {
  switch (difficulty) {
    case 'A2':
      return 'Sentence: 6-12 words, simple or compound only, A1-A2 vocabulary. It must rely on an '
        + 'explicit sequence word ("First", "Then", "After that") or a repeated noun. Paragraph: 3-5 '
        + 'short sentences, 40-70 words.';
    case 'B1':
      return 'Sentence: 10-16 words with at most one subordinate clause. It must rely on pronoun '
        + 'reference plus a basic connective (however, therefore, for example). Paragraph: 4-6 '
        + 'sentences, 60-100 words.';
    case 'B2':
      return 'Sentence: 12-20 words. It must rely on a lexical chain or a discourse marker, and must '
        + 'develop or qualify the argument rather than merely restate it. Paragraph: 5-7 sentences, '
        + '80-130 words.';
    case 'C1':
      return 'Sentence: 15-25 words using a subtle concession, qualification, nominalization, or '
        + 'anaphora to an abstract noun. All four positions must be grammatically possible so that '
        + 'only discourse logic identifies the answer. Paragraph: 5-8 sentences, 90-150 words.';
  }
}

function buildSentenceInsertionPrompt(article: string, difficulty: Difficulty, analysis?: ArticleAnalysisMap | null): string {
  const profile = getDifficultyProfile(difficulty);
  return `
${buildSectionPromptHeader(article, difficulty, 'Sentence insertion')}
${formatAnalysisMap(analysis)}

Create EXACTLY ${EXPECTED_INSERTION_COUNT} sentence-insertion items (ids si1, si2).

Each item:
- sentence: ONE new sentence that does NOT appear in the article and that belongs at exactly one of four positions.
- paragraph: ONE paragraph copied VERBATIM from the article, with exactly four inline markers
  inserted at four different positions: [1] [2] [3] [4], in that order from left to right.
- answer: the marker number (1, 2, 3 or 4) where the sentence belongs.
- explanation: one sentence naming the cohesion signal (reference, connective, or lexical chain) that proves the position.

Hard constraints (an item is unusable if any is broken):
- Do NOT add, delete, or reword a single word of the paragraph. Only insert the four markers.
- Place each marker BETWEEN words or immediately after punctuation — never inside a word.
- The markers must be the literal text [1] [2] [3] [4], each appearing exactly once, in ascending order.
- sentence must NOT appear anywhere in the article, verbatim or near-verbatim.
- Exactly ONE position must be correct; the other three must be clearly wrong.
- The two items must not reuse the same paragraph.

Difficulty guidance:
- ${buildInsertionLevelGuidance(difficulty)}
- Sentence style: ${profile.sentence.guidance}
- Vocabulary: ${profile.vocabulary.guidance}

Example of the required marker style:
"paragraph": "The first sentence stays whole.[1] The second sentence continues [2] the same idea. A third sentence follows.[3] The final sentence closes the paragraph.[4]"

JSON schema:
{
  "sentenceInsertion": [
    { "id": "si1", "sentence": "One new sentence.", "paragraph": "Paragraph text with [1] four [2] markers [3] inside.[4]", "answer": 2, "explanation": "Position 2 is the only place the reference resolves." },
    { "id": "si2", "sentence": "Another new sentence.", "paragraph": "Different paragraph with [1] four [2] markers [3] inside.[4]", "answer": 3, "explanation": "Position 3 follows the cause it depends on." }
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

interface SummarySectionResponse {
  title?: string;
  articleSnippet?: string;
  summary?: {
    paragraph?: string;
    blanks?: string[];
    blankTargets?: SummaryBlankTarget[];
  };
}

interface SummaryBlankTarget {
  answer: string;
  role: 'central-concept' | 'cause-or-mechanism' | 'key-development' | 'contrast-or-limitation' | 'result-or-conclusion';
  sourceArea: string;
}

export interface MCSectionResponse {
  multipleChoice?: MCQuestion[];
}

interface SyntaxSectionResponse {
  syntaxDeconstruction?: SyntaxDeconstructionItem[];
}

interface InsertionSectionResponse {
  sentenceInsertion?: SentenceInsertionQuestion[];
}

interface WritingSectionResponse {
  writingWorkshop?: {
    expansion?: ExpansionItem[];
    keywords?: string[];
    qaChain?: string[];
    criticalThinking?: string;
  };
  keys?: {
    expansion?: string[];
    qa?: string[];
    critical?: string;
  };
}

async function generateJSONSection<T = any>(
  label: string,
  prompt: string,
  aiConfig: AIConfig,
  onProgress?: (message: string) => void,
  maxTokens?: number,
  retries = 1,
): Promise<T> {
  onProgress?.(label);
  const startedAt = Date.now();
  try {
    return await withRetry(() => callJSON(prompt, aiConfig, maxTokens), retries) as T;
  } finally {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.info(`[generation] ${label} completed in ${seconds}s (${prompt.length} chars prompt, maxTokens=${maxTokens || 'default'})`);
  }
}

function buildArticleAnalysisPrompt(article: string): string {
  return `
Analyze the article before worksheet generation. Return ONLY compact valid JSON.
This is an internal evidence map, not student-facing content.

Required fields:
- centralThesis: one precise sentence covering the whole article.
- paragraphFunctions: each major paragraph/section labelled P1, P2, etc. with its argumentative function.
- keyFacts: 3-6 central stated facts, never trivia.
- implicitInferences: at least 4 unstated but text-supported implications, each with two evidence references when possible.
- logicalRelations: cause/effect, contrast, qualification, limitation, or development links with evidence references.
- authorAttitude: a precise stance/tone label plus at least two wording signals.
- evidencePairCandidates: at least 2 inferential claims, each with quotations or short evidence references that directly prove it.

Do not use outside knowledge. Distinguish what is stated from what is inferred.

JSON schema:
{
  "centralThesis": "...",
  "paragraphFunctions": [{ "paragraph": "P1", "function": "introduces the problem" }],
  "keyFacts": ["..."],
  "implicitInferences": [{ "inference": "...", "evidence": ["P2", "P5"] }],
  "logicalRelations": [{ "relation": "...", "evidence": ["P3", "P4"] }],
  "authorAttitude": { "label": "cautiously supportive", "evidence": ["short wording signal 1", "short wording signal 2"] },
  "evidencePairCandidates": [{ "claim": "...", "evidence": ["short quote 1", "short quote 2"] }]
}

Article:
${article}
`;
}

function isUsableArticleAnalysis(value: any): value is ArticleAnalysisMap {
  return Boolean(
    value &&
    typeof value.centralThesis === 'string' && value.centralThesis.trim() &&
    Array.isArray(value.paragraphFunctions) && value.paragraphFunctions.length >= 2 &&
    Array.isArray(value.keyFacts) && value.keyFacts.length >= 3 &&
    Array.isArray(value.implicitInferences) && value.implicitInferences.length >= 3 &&
    value.authorAttitude && Array.isArray(value.authorAttitude.evidence) && value.authorAttitude.evidence.length >= 2 &&
    Array.isArray(value.evidencePairCandidates) && value.evidencePairCandidates.length >= 1
  );
}

async function generateArticleAnalysisMap(
  article: string,
  aiConfig: AIConfig,
  onProgress?: (message: string) => void,
): Promise<ArticleAnalysisMap> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generateJSONSection<ArticleAnalysisMap>(
      attempt === 1 ? 'Mapping article evidence' : 'Repairing article evidence map',
      buildArticleAnalysisPrompt(article),
      aiConfig,
      onProgress,
      6000,
    );
    if (isUsableArticleAnalysis(result)) return result;
  }
  throw new Error('Could not build a reliable article evidence map. Please retry generation.');
}

export function getInvalidB2QuestionIds(questions: MCQuestion[]): string[] {
  if (!Array.isArray(questions) || questions.length !== 10) {
    return Array.from({ length: 10 }, (_, index) => `q${index + 1}`);
  }

  const invalid = new Set<string>();
  const byId = new Map(questions.map(question => [question.id, question]));

  for (let slot = 1; slot <= 10; slot++) {
    const id = `q${slot}`;
    const question = byId.get(id);
    const rule = B2_MC_SLOT_RULES[slot];
    if (!question) {
      invalid.add(id);
      continue;
    }
    // Canonicalize the same way validateMC does, otherwise a capitalized
    // "Inference" passes here but blocks the worksheet in the UI forever.
    if (
      canonicalMCQuestionType(question.type) !== rule.type ||
      canonicalCognitiveLevel(question.cognitiveLevel) !== rule.level ||
      canonicalMCScope(question.scope) !== rule.scope
    ) {
      invalid.add(id);
    }
    if (!question.question?.trim() || question.options?.length !== 4 || !/^[A-D]$/.test(question.answer || '') || !question.explanation?.trim()) invalid.add(id);
    if (slot !== 2 && /^according to\b/i.test(question.question.trim())) invalid.add(id);
    if (slot === 2 && B2_Q2_TRIVIA_STEM.test((question.question || '').replace(/\bq\d+\b/gi, ' '))) invalid.add(id);
    if (B2_REASONING_SLOTS.has(slot)) {
      if (!Array.isArray(question.evidence) || question.evidence.length < 2) invalid.add(id);
      if (!Array.isArray(question.reasoningSteps) || question.reasoningSteps.length < 2) invalid.add(id);
    }
    if (!question.skillTarget?.trim()) invalid.add(id);
    const wrongLetters = ['A', 'B', 'C', 'D'].filter(letter => letter !== question.answer);
    if (!question.distractors || wrongLetters.some(letter => !question.distractors?.[letter]?.rationale)) invalid.add(id);
  }

  const attitude = byId.get('q8');
  if (!attitude || !/(attitude|tone|stance|viewpoint|position)/i.test(`${attitude.question} ${attitude.skillTarget || ''}`)) invalid.add('q8');

  const q6 = byId.get('q6');
  const q7 = byId.get('q7');
  const pairValid = q6?.evidencePairLink?.claimQuestionId === 'q6' && q6.evidencePairLink.evidenceQuestionId === 'q7' &&
    q7?.evidencePairLink?.claimQuestionId === 'q6' && q7.evidencePairLink.evidenceQuestionId === 'q7';
  if (!pairValid) {
    invalid.add('q6');
    invalid.add('q7');
  }

  const seenQuestions = new Map<string, string>();
  for (const question of questions) {
    const normalized = question.question?.toLocaleLowerCase().replace(/\W+/g, ' ').trim();
    if (!normalized) continue;
    const existing = seenQuestions.get(normalized);
    if (existing) {
      invalid.add(existing);
      invalid.add(question.id);
    } else {
      seenQuestions.set(normalized, question.id);
    }
  }

  return [...invalid].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// ---------------------------------------------------------------------------
// Option-length enforcement (word count, relative to the correct answer)
// ---------------------------------------------------------------------------

const MC_MAX_CHECK_ROUNDS = 3; // 3 checks, at most 2 regeneration rounds

interface MCViolationReport {
  invalidIds: string[];
  hardInvalidIds: string[];
  lengthInvalidIds: string[];
}

function getQuestionNumber(id: string): number | null {
  const match = /^q(\d+)$/i.exec(String(id ?? '').trim());
  return match ? Number(match[1]) : null;
}

function sortQuestionIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const aNum = getQuestionNumber(a);
    const bNum = getQuestionNumber(b);
    if (aNum === null && bNum === null) return a.localeCompare(b);
    if (aNum === null) return 1;
    if (bNum === null) return -1;
    return aNum - bNum;
  });
}

/**
 * Option length violations on normalized text: option prefixes ("A.", "1.") are
 * stripped and the answer is canonicalized, matching validateMC's own
 * normalization so the generation loop and the validator agree.
 */
function getNormalizedLengthViolations(question: MCQuestion) {
  const options = Array.isArray(question.options) ? question.options.map(stripPrefix) : question.options;
  return getOptionLengthViolations(options, normalizeAnswerToken(question.answer));
}

/** Ids of questions whose distractor word counts drift from the correct option. */
export function getLengthInvalidQuestionIds(questions: MCQuestion[]): string[] {
  if (!Array.isArray(questions)) return [];
  const invalid: string[] = [];
  for (const question of questions) {
    if (!question?.id) continue;
    if (getNormalizedLengthViolations(question).length > 0) invalid.push(question.id);
  }
  return sortQuestionIds(invalid);
}

function getMCViolationReport(questions: MCQuestion[], difficulty: Difficulty): MCViolationReport {
  const hardInvalidIds = difficulty === 'B2' ? getInvalidB2QuestionIds(questions) : [];
  const lengthInvalidIds = getLengthInvalidQuestionIds(questions);
  return {
    invalidIds: sortQuestionIds([...hardInvalidIds, ...lengthInvalidIds]),
    hardInvalidIds: sortQuestionIds(hardInvalidIds),
    lengthInvalidIds,
  };
}

export function getInvalidMCQuestionIds(questions: MCQuestion[], difficulty: Difficulty): string[] {
  return getMCViolationReport(questions, difficulty).invalidIds;
}

// ---------------------------------------------------------------------------
// Single-question regeneration
// ---------------------------------------------------------------------------

function getTargetSlotForQuestion(
  existing: MCQuestion,
  questionId: string,
  difficulty: Difficulty,
): { type: MCQuestionType; level?: NonNullable<MCQuestion['cognitiveLevel']>; scope?: NonNullable<MCQuestion['scope']> } {
  if (difficulty === 'B2') {
    const slot = getB2SlotNumber(questionId);
    const rule = slot === null ? undefined : B2_MC_SLOT_RULES[slot];
    if (rule) return { type: rule.type, level: rule.level, scope: rule.scope };
  }
  return { type: existing.type, level: existing.cognitiveLevel, scope: existing.scope };
}

/** Build a prompt that rewrites exactly one MCQ while keeping its skill slot. */
export function buildSingleMCQuestionPrompt(
  article: string,
  difficulty: Difficulty,
  questionId: string,
  questions: MCQuestion[],
): string {
  const existing = questions.find(question => question.id === questionId);
  if (!existing) throw new Error(`Question ${questionId} is not part of this worksheet.`);

  const slot = getB2SlotNumber(questionId) ?? (questions.indexOf(existing) + 1);
  const base = buildMCBatchPrompt(article, difficulty, slot, slot);
  const otherStems = questions
    .filter(question => question.id !== questionId)
    .map(question => `- ${question.id}: ${question.question}`)
    .join('\n');
  const siblingId = questionId === 'q6' ? 'q7' : questionId === 'q7' ? 'q6' : null;
  const sibling = siblingId ? questions.find(question => question.id === siblingId) : null;

  return `${base}

IMPROVEMENT BRIEF — rewrite ONLY ${questionId}; do not repeat the current stem or its options.
Current item: ${JSON.stringify(existing)}
Existing stems to avoid (do not duplicate their content or wording):
${otherStems}
${sibling ? `Linked pair context (${sibling.id} must keep working with the new item): ${JSON.stringify({ question: sibling.question, options: sibling.options })}` : ''}
Keep the assigned slot exactly (type, cognitiveLevel, scope). Make the new item more discriminating: keep the same skill, but use fresh evidence and a distractor set that punishes superficial reading.
Return exactly one question with id "${questionId}" in the JSON schema above.`;
}

function normalizeStemForComparison(stem: unknown): string {
  return String(stem ?? '').toLowerCase().replace(/\W+/g, ' ').trim();
}

/**
 * Reasons why a regenerated item is not acceptable (empty array = acceptable).
 * Deliberately stricter than full-generation checks: the user asked for a
 * better item, so a failed candidate triggers another attempt.
 */
export function isRegeneratedMCQuestionAcceptable(
  candidate: MCQuestion,
  existing: MCQuestion,
  difficulty: Difficulty,
  all: MCQuestion[],
): string[] {
  const reasons: string[] = [];
  if (!candidate || typeof candidate !== 'object') return ['no question was returned'];

  const id = String(candidate.id ?? '').trim().toLowerCase();
  if (id !== existing.id.toLowerCase()) reasons.push('keeps the wrong id');
  if (!candidate.question?.trim()) reasons.push('has an empty stem');
  if (!Array.isArray(candidate.options) || candidate.options.length !== 4 || candidate.options.some(option => !String(option ?? '').trim())) {
    reasons.push('needs exactly four non-empty options');
  }
  if (!/^[A-D]$/.test(normalizeAnswerToken(candidate.answer))) reasons.push('needs an answer letter A-D');
  if (!candidate.explanation?.trim()) reasons.push('needs an explanation');

  const target = getTargetSlotForQuestion(existing, existing.id, difficulty);
  if (
    canonicalMCQuestionType(candidate.type) !== target.type ||
    (target.level !== undefined && canonicalCognitiveLevel(candidate.cognitiveLevel) !== target.level) ||
    (target.scope !== undefined && canonicalMCScope(candidate.scope) !== target.scope)
  ) {
    reasons.push('does not match the assigned slot');
  }

  if (!candidate.skillTarget?.trim()) reasons.push('needs a skillTarget');

  const slot = getB2SlotNumber(existing.id);
  if (difficulty === 'B2' && slot !== null && B2_REASONING_SLOTS.has(slot)) {
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length < 2) reasons.push('needs at least two evidence references');
    if (!Array.isArray(candidate.reasoningSteps) || candidate.reasoningSteps.length < 2) reasons.push('needs at least two reasoning steps');
  }
  if (slot === 8 && !/(attitude|tone|stance|viewpoint|position)/i.test(`${candidate.question} ${candidate.skillTarget || ''}`)) {
    reasons.push('must still test author attitude or stance');
  }
  if (difficulty === 'B2' && slot === 2 && B2_Q2_TRIVIA_STEM.test((candidate.question || '').replace(/\bq\d+\b/gi, ' '))) {
    reasons.push('must not test an isolated number or percentage');
  }

  const answer = normalizeAnswerToken(candidate.answer);
  const wrongLetters = ['A', 'B', 'C', 'D'].filter(letter => letter !== answer);
  if (!candidate.distractors || wrongLetters.some(letter => !candidate.distractors?.[letter]?.rationale?.trim())) {
    reasons.push('needs distractor rationales for every wrong option');
  }

  if (Array.isArray(candidate.options) && candidate.options.length === 4) {
    if (getOptionLengthViolations(candidate.options, answer).length > 0) {
      reasons.push('option word counts must be within 2 words of the correct option');
    }
  }

  const stem = normalizeStemForComparison(candidate.question);
  if (stem && all.some(other => other.id !== existing.id && normalizeStemForComparison(other.question) === stem)) {
    reasons.push('duplicates another question stem');
  }

  return reasons;
}

/** Replace one item in place, forcing the authoritative slot metadata. */
export function applyRegeneratedMCQuestion(
  all: MCQuestion[],
  candidate: MCQuestion,
  difficulty: Difficulty,
): MCQuestion[] {
  const existing = all.find(question => question.id === candidate.id);
  if (!existing) throw new Error(`Question ${candidate.id} is not part of this worksheet.`);

  const target = getTargetSlotForQuestion(existing, existing.id, difficulty);
  const normalized: MCQuestion = {
    ...candidate,
    id: existing.id,
    type: target.type,
    ...(target.level !== undefined ? { cognitiveLevel: target.level } : {}),
    ...(target.scope !== undefined ? { scope: target.scope } : {}),
    answer: normalizeAnswerToken(candidate.answer),
  };
  if (existing.id === 'q6' || existing.id === 'q7') {
    normalized.evidencePairLink = { claimQuestionId: 'q6', evidenceQuestionId: 'q7' };
  }

  return all.map(question => (question.id === existing.id ? normalized : question));
}

/**
 * Rewrite one MCQ in place, keeping its id and skill slot. Retries up to three
 * times; throws with the remaining reasons instead of returning a worse item.
 */
export async function regenerateMCQuestion(
  article: string,
  difficulty: Difficulty,
  questionId: string,
  questions: MCQuestion[],
  onProgress?: (message: string) => void,
  generate?: (prompt: string) => Promise<{ multipleChoice?: MCQuestion[] }>,
): Promise<MCQuestion> {
  const existing = questions.find(question => question.id === questionId);
  if (!existing) throw new Error(`Question ${questionId} is not part of this worksheet.`);

  const generateFn = generate ?? ((prompt: string) => {
    const config = getActiveConfig();
    if (!config?.apiKey) throw new Error('No active AI provider configured. Please set up your API key in Settings.');
    return generateJSONSection<MCSectionResponse>(`Regenerating ${questionId}`, prompt, config, onProgress);
  });

  const basePrompt = buildSingleMCQuestionPrompt(article, difficulty, questionId, questions);
  let correction = '';
  let lastReasons: string[] = ['no usable question was returned'];

  for (let attempt = 1; attempt <= 3; attempt++) {
    onProgress?.(`Regenerating ${questionId} (attempt ${attempt}/3)…`);
    const response = await generateFn(`${basePrompt}${correction}`);
    const raw = Array.isArray(response?.multipleChoice) ? response.multipleChoice[0] : null;
    if (raw) {
      const candidate = { ...raw, id: questionId };
      const reasons = isRegeneratedMCQuestionAcceptable(candidate, existing, difficulty, questions);
      if (reasons.length === 0) return candidate;
      lastReasons = reasons;
    } else {
      lastReasons = ['no usable question was returned'];
    }
    correction = `\n\nRETRY CORRECTION: the previous replacement failed validation: ${lastReasons.join('; ')}. Fix every listed problem and return the complete replacement.`;
  }

  throw new Error(`Could not regenerate ${questionId}: ${lastReasons.join('; ')}`);
}

/**
 * Merge a regenerated 5-question half back in, keyed by id. Regenerated items
 * win; omitted ids keep their previous version; extras are discarded. Without
 * this, a partial retry response could silently shrink the worksheet.
 */
function canonicalQuestionId(id: unknown): string {
  return String(id ?? '').trim().toLowerCase();
}

/**
 * Merge a regenerated 5-question half back in, keyed by a canonical id
 * (trimmed, lowercased) so "Q3" / " q3 " match "q3". Regenerated items win;
 * omitted ids keep their previous version; extras are discarded. Emitted ids
 * are canonicalized to qN so keys and later retries stay aligned.
 */
export function mergeRegeneratedHalf(
  previous: MCQuestion[],
  regenerated: MCQuestion[],
  start: number,
  end: number,
): MCQuestion[] {
  const byId = new Map<string, MCQuestion>();
  for (const question of [...previous, ...regenerated]) {
    const id = canonicalQuestionId(question?.id);
    if (id) byId.set(id, question);
  }
  const merged: MCQuestion[] = [];
  for (let slot = start; slot <= end; slot++) {
    const canonical = `q${slot}`;
    const question = byId.get(canonical);
    if (!question) continue;
    merged.push(question.id === canonical ? question : { ...question, id: canonical });
  }
  return merged;
}

function describeLengthViolation(question: MCQuestion): string {
  const violations = getNormalizedLengthViolations(question);
  if (violations.length === 0) return '';
  const { correctLetter, correctWords } = violations[0];
  const wrong = violations.map(violation => `${violation.letter}=${violation.words}w`).join(', ');
  return `${question.id} (correct ${correctLetter}=${correctWords}w; ${wrong})`;
}

function buildMCRetryCorrection(
  ids: string[],
  report: MCViolationReport,
  questions: MCQuestion[],
): string {
  const byId = new Map(questions.map(question => [question.id, question]));
  const measured = ids
    .map(id => {
      const question = byId.get(id);
      return question ? describeLengthViolation(question) : '';
    })
    .filter(Boolean);

  const lines = [
    `\nRETRY CORRECTION: The previous response failed validation for: ${ids.join(', ')}.`,
    'Return the COMPLETE requested range, including questions that already pass; do not omit any id.',
    `OPTION-LENGTH RULE (word count, all levels): every wrong option must be within ${OPTION_LENGTH_TOLERANCE_WORDS} words of the correct option.`,
  ];
  if (measured.length > 0) {
    lines.push(`Measured violations: ${measured.join('; ')}.`);
  }
  lines.push(
    `If the correct option has 1 word, every distractor must have 1-${1 + OPTION_LENGTH_TOLERANCE_WORDS} words; ` +
    `if it has 4 words, every distractor must have ${Math.max(1, 4 - OPTION_LENGTH_TOLERANCE_WORDS)}-${4 + OPTION_LENGTH_TOLERANCE_WORDS} words. ` +
    'Rewrite the option wording, not the question stem, and keep the answer a valid letter.'
  );
  if (report.hardInvalidIds.length > 0) {
    lines.push(
      `B2 SLOT REQUIREMENTS: the previous batch failed hard validation for: ${report.hardInvalidIds.join(', ')}. ` +
      'Follow every assigned slot exactly, including type, cognitiveLevel, skillTarget, scope, two evidence references, two reasoning steps, distractor metadata, and the q6/q7 link.'
    );
  }
  return lines.join('\n');
}

async function generateCompleteMCSection(
  article: string,
  difficulty: Difficulty,
  aiConfig: AIConfig,
  onProgress?: (message: string) => void,
  analysis?: ArticleAnalysisMap | null,
): Promise<MCSectionResponse> {
  const generateBatch = (start: number, end: number, correction = '') => generateJSONSection<MCSectionResponse>(
    correction ? `Regenerating questions q${start}-q${end}` : `Generating logical analysis q${start}-q${end}`,
    buildMCBatchPrompt(article, difficulty, start, end, analysis) + correction,
    aiConfig,
    onProgress,
  );

  let [first, second] = await Promise.all([generateBatch(1, 5), generateBatch(6, 10)]);

  // Non-B2 keeps the original single generation pass: no length-triggered API
  // retries. Length issues still surface as validator warnings.
  if (difficulty !== 'B2') {
    const combined = [...ensureArray(first.multipleChoice, 'multipleChoice'), ...ensureArray(second.multipleChoice, 'multipleChoice')];
    const remainingLength = getLengthInvalidQuestionIds(combined);
    if (remainingLength.length > 0) {
      console.warn(`[generation] ${difficulty} length warnings for ${remainingLength.join(', ')}; no retry (non-B2)`);
    }
    return { multipleChoice: combined };
  }

  let regenerationRounds = 0;
  for (let round = 0; round < MC_MAX_CHECK_ROUNDS; round++) {
    const combined = [...ensureArray(first.multipleChoice, 'multipleChoice'), ...ensureArray(second.multipleChoice, 'multipleChoice')];
    const report = getMCViolationReport(combined, difficulty);
    if (report.invalidIds.length === 0) {
      if (regenerationRounds > 0) {
        console.info(`[generation] B2 MC settled after ${regenerationRounds} regeneration round(s)`);
      }
      return { multipleChoice: combined };
    }
    if (round === MC_MAX_CHECK_ROUNDS - 1) break;
    // Length-only issues get at most one regeneration round. A second round is
    // reserved for B2 hard slot/evidence failures, matching the old budget.
    if (report.hardInvalidIds.length === 0 && regenerationRounds >= 1) break;

    const firstIds = report.invalidIds.filter(id => {
      const number = getQuestionNumber(id);
      return number !== null && number >= 1 && number <= 5;
    });
    const secondIds = report.invalidIds.filter(id => {
      const number = getQuestionNumber(id);
      return number !== null && number >= 6 && number <= 10;
    });

    const jobs: Promise<void>[] = [];
    if (firstIds.length > 0) {
      const firstReport: MCViolationReport = {
        invalidIds: firstIds,
        hardInvalidIds: report.hardInvalidIds.filter(id => firstIds.includes(id)),
        lengthInvalidIds: report.lengthInvalidIds.filter(id => firstIds.includes(id)),
      };
      jobs.push(generateBatch(1, 5, buildMCRetryCorrection(firstIds, firstReport, combined)).then(value => {
        first = {
          multipleChoice: mergeRegeneratedHalf(
            ensureArray(first.multipleChoice, 'multipleChoice'),
            ensureArray(value.multipleChoice, 'multipleChoice'),
            1, 5,
          ),
        };
      }));
    }
    if (secondIds.length > 0) {
      const secondReport: MCViolationReport = {
        invalidIds: secondIds,
        hardInvalidIds: report.hardInvalidIds.filter(id => secondIds.includes(id)),
        lengthInvalidIds: report.lengthInvalidIds.filter(id => secondIds.includes(id)),
      };
      jobs.push(generateBatch(6, 10, buildMCRetryCorrection(secondIds, secondReport, combined)).then(value => {
        second = {
          multipleChoice: mergeRegeneratedHalf(
            ensureArray(second.multipleChoice, 'multipleChoice'),
            ensureArray(value.multipleChoice, 'multipleChoice'),
            6, 10,
          ),
        };
      }));
    }
    if (jobs.length === 0) break; // ids not mappable to a batch; avoid pointless rounds
    await Promise.all(jobs);
    regenerationRounds++;
  }

  // Best-effort: return the last generated batch instead of failing the whole
  // generation. Downstream validation surfaces any remaining quality issues as
  // warnings, so the user still gets a usable worksheet.
  const bestEffort = [...ensureArray(first.multipleChoice, 'multipleChoice'), ...ensureArray(second.multipleChoice, 'multipleChoice')];
  const remaining = getMCViolationReport(bestEffort, difficulty).invalidIds;
  if (remaining.length > 0) {
    console.warn(`[generation] ${difficulty} MC quality issues remain after retries: ${remaining.join(', ')}`);
  }
  return { multipleChoice: bestEffort };
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
    options.sentenceInsertion ? 'insertion' : null,
    options.syntaxDeconstruction ? 'syntax' : null,
    selectedWriting ? 'writing' : null,
  ].filter(Boolean);
  let completedTasks = 0;
  const mark = (label: string) => {
    onProgress?.(`${label} (${Math.min(completedTasks + 1, selectedTasks.length)}/${selectedTasks.length})...`);
  };

  // B2 quality depends on a shared interpretation of the whole article. Build
  // one compact map first, then let Summary and both MC batches use it. If the
  // map can't be built, degrade gracefully and generate from the raw article
  // (the prompts accept a null analysis) instead of failing the whole run.
  let analysis: ArticleAnalysisMap | null = null;
  if (difficulty === 'B2' && (options.summary || options.mc || options.sentenceInsertion)) {
    try {
      analysis = await generateArticleAnalysisMap(article, aiConfig, onProgress);
    } catch {
      analysis = null;
    }
  }

  const summaryPromise = options.summary
    ? generateCompleteSummarySection(article, difficulty, aiConfig, mark, analysis)
    : Promise.resolve({} as SummarySectionResponse);

  const mcPromise = options.mc
    ? generateCompleteMCSection(article, difficulty, aiConfig, mark, analysis)
      .then(part => {
        completedTasks++;
        onProgress?.(`Questions complete (${completedTasks}/${selectedTasks.length})...`);
        return part;
      })
    : Promise.resolve({ multipleChoice: [] } as MCSectionResponse);

  const syntaxPromise = options.syntaxDeconstruction
    ? generateJSONSection<SyntaxSectionResponse>('Generating syntax section', buildSyntaxSectionPrompt(article, difficulty), aiConfig, mark)
        .then(part => {
          completedTasks++;
          onProgress?.(`Syntax complete (${completedTasks}/${selectedTasks.length})...`);
          return part;
        })
    : Promise.resolve({} as SyntaxSectionResponse);

  const writingPromise = selectedWriting
    ? generateJSONSection<WritingSectionResponse>('Generating writing section', buildWritingSectionPrompt(article, difficulty, options), aiConfig, mark)
        .then(part => {
          completedTasks++;
          onProgress?.(`Writing complete (${completedTasks}/${selectedTasks.length})...`);
          return part;
        })
    : Promise.resolve({} as WritingSectionResponse);

  // Insertion is a brand-new optional section: swallow any failure so it can
  // never break the existing summary/MC/syntax/writing pipeline.
  const insertionPromise = options.sentenceInsertion
    ? generateJSONSection<InsertionSectionResponse>('Generating sentence insertion section', buildSentenceInsertionPrompt(article, difficulty, analysis), aiConfig, mark)
        .then(part => {
          completedTasks++;
          onProgress?.(`Sentence insertion complete (${completedTasks}/${selectedTasks.length})...`);
          return part;
        })
        .catch(err => {
          console.warn('Sentence insertion generation failed:', err?.message || err);
          return { sentenceInsertion: [] } as InsertionSectionResponse;
        })
    : Promise.resolve({ sentenceInsertion: [] } as InsertionSectionResponse);

  const summaryPart = await summaryPromise.then(part => {
    if (options.summary) {
      completedTasks++;
      onProgress?.(`Summary complete (${completedTasks}/${selectedTasks.length})...`);
    }
    return part;
  });
  const [mcParts, syntaxPart, writingPart, insertionPart] = await Promise.all([mcPromise, syntaxPromise, writingPromise, insertionPromise]);

  onProgress?.('Assembling worksheet...');

  const multipleChoice = (options.mc
    ? ensureArray(mcParts.multipleChoice, 'multipleChoice')
    : []
  ).sort((a, b) => {
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

  // Reconcile summary paragraph [BLANK] markers with the answer list so the
  // summary, blanks, and keys always match.
  const repairedSummary = repairSummary({
    paragraph: summaryPart.summary?.paragraph || '',
    blanks: Array.isArray(summaryPart.summary?.blanks) ? summaryPart.summary.blanks : [],
  });

  // Only present when requested, so untoggled worksheets stay undefined and the
  // insertion validator stays silent for them.
  const sentenceInsertion = options.sentenceInsertion
    ? repairSentenceInsertionItems(insertionPart.sentenceInsertion)
    : undefined;

  return {
    title: summaryPart.title || 'Untitled Worksheet',
    articleSnippet: summaryPart.articleSnippet || article.slice(0, 900),
    header: {
      brand: 'OTIA',
      nameLabel: 'Name',
      scoreLabel: 'Score',
    },
    summary: repairedSummary,
    multipleChoice,
    sentenceInsertion,
    syntaxDeconstruction,
    writingWorkshop: {
      expansion,
      keywords,
      qaChain,
      criticalThinking: options.writing_critical ? (writingPart.writingWorkshop?.criticalThinking || '') : '',
    },
    keys: {
      summary: repairedSummary.blanks,
      mc: multipleChoice.reduce((acc: Record<string, string>, q: any) => {
        if (q.id && q.answer) acc[q.id] = q.answer;
        return acc;
      }, {}),
      sentenceInsertion: (sentenceInsertion || []).reduce((acc: Record<string, number>, item) => {
        if (item.id && Number.isInteger(item.answer) && item.answer >= 1 && item.answer <= 4) acc[item.id] = item.answer;
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
  sentenceInsertion: false,
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
  let data = await generateSectionedWorksheet(article, difficulty, aiConfig, onProgress, generationOptions);
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
