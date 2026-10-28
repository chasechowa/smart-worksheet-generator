# B2 Quality Hardening + Single-Question Regeneration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten B2 prompt boundaries that let weak items through, and let the user regenerate one MCQ in place while keeping its skill slot.

**Architecture:** Quality rules live in the B2 blueprint/prompt plus one hard generation check (Q2 must not test an isolated number). Single-question regeneration reuses `buildMCBatchPrompt` for the slot, adds an improvement brief, validates the candidate with the same rules as full generation, retries up to 3 times, and replaces the item in `data.multipleChoice` (keys re-derived). UI gets a ↻ button in editor view and a one-step Undo.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, existing `generateJSONSection` / `callJSON` path.

**Spec:** This plan (no separate design doc; scope agreed in chat on 2026-10-28).

## Global Constraints

- B2 fixed blueprint stays authoritative: `validators/mcValidator.ts` `B2_MC_SLOT_RULES` is the only slot table.
- Regeneration must preserve the target question's slot (B2: blueprint; other levels: the existing item's `type`/`cognitiveLevel`/`scope`) and its `id`.
- Quality failures on a regenerated item must retry (max 3) and then fail loudly; never silently accept a worse item.
- Existing behavior to keep: full-generation speed (no new whole-section retries), all current tests green, no new dependencies.
- UI button appears only in `viewMode === 'editor'`; never in print, PDF, interactive, or exported HTML.
- Keep `PROJECT_STATUS.md` in sync and deploy via `npm run build` + `npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main`.

## Review Focus

- A user clicks ↻ on q7 while the worksheet has an existing q6/q7 pair: the new q7 must keep the pair link and must not orphan q6.
- The API returns invalid JSON or zero questions: UI must show an error and leave the worksheet untouched.
- The user regenerates q8: the replacement must still explicitly test attitude/tone/stance.
- The user regenerates q2: the replacement must not become another percentage question.
- The user clicks ↻ twice quickly: second click must be ignored while the first request is in flight.

---

### Task 1: B2 Q2 must not test an isolated number

**Files:**
- Modify: `services/aiService.ts` (`buildLevelMCBlueprint` B2 Q2 line; `getInvalidB2QuestionIds`)
- Modify: `validators/mcValidator.ts` (B2 warning for numeric Q2)
- Test: `services/__tests__/b2QuestionQuality.test.ts`

**Interfaces:**
- Produces: `getInvalidB2QuestionIds(questions)` now flags `q2` when the stem matches `/\d|percent|%/i`.

- [ ] **Step 1: Write failing tests**

```ts
it('rejects a percentage/trivia Q2 in B2', () => {
  const questions = makeValidQuestions();
  questions[1].question = 'According to Provine, what proportion of laughter is social?';
  expect(getInvalidB2QuestionIds(questions)).toContain('q2');
});

it('accepts a conceptual Q2', () => {
  const questions = makeValidQuestions();
  questions[1].question = 'Which stated finding most directly supports the article’s central claim?';
  expect(getInvalidB2QuestionIds(questions)).not.toContain('q2');
});
```

- [ ] **Step 2: Run tests, confirm the first fails**

Run: `npx vitest run services/__tests__/b2QuestionQuality.test.ts`
Expected: FAIL — `q2` not flagged.

- [ ] **Step 3: Implement**

In `getInvalidB2QuestionIds`, after the structural checks:

```ts
if (slot === 2 && /\d|percent|%/i.test(question.question || '')) invalid.add(id);
```

Change the B2 Q2 blueprint line to: `... Ask for the ONE central stated fact that best supports the argument — never a statistic, percentage, date, name, or isolated number.`

In `validateMC` (B2 block), add a **warning** when Q2's stem is numeric: `Q2: tests an isolated number/percentage; B2 expects a central stated fact.`

- [ ] **Step 4: Run tests**

Run: `npx vitest run services/__tests__/b2QuestionQuality.test.ts validators/__tests__/mcValidator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/aiService.ts validators/mcValidator.ts services/__tests__/b2QuestionQuality.test.ts
git commit -m "feat: reject numeric B2 Q2 stems that violate the blueprint"
```

---

### Task 2: Harden distractor, quote-pair, and attitude prompts

**Files:**
- Modify: `services/aiService.ts` (`buildMCBatchPrompt` quality rules; B2 Q7/Q8 blueprint lines)
- Test: `services/__tests__/b2QuestionQuality.test.ts` (export `buildMCBatchPrompt` first)

**Interfaces:**
- Produces: `export function buildMCBatchPrompt(...)` (already exists, add `export`).
- Produces prompt text containing these exact substrings (tests pin them):
  - `must not also support the claim`
  - `Never use absolute or overreaching wording`
  - `generic "What is the author's attitude?" stem`

- [ ] **Step 1: Write failing test**

```ts
import { buildMCBatchPrompt } from '../aiService';

it('states the hardened B2 quality rules in the batch prompt', () => {
  const prompt = buildMCBatchPrompt('Article text', 'B2', 6, 10);
  expect(prompt).toContain('must not also support the claim');
  expect(prompt).toContain('Never use absolute or overreaching wording');
  expect(prompt).toContain('generic "What is the author\'s attitude?" stem');
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx vitest run services/__tests__/b2QuestionQuality.test.ts -t "hardened"`

- [ ] **Step 3: Implement prompt rules**

Add to the `Quality rules` block:

```
- Distractors must be plausible text-based misreadings. Never use absolute or overreaching wording (always, never, only, all, completely, prove, most important) and never an off-topic option the article does not discuss.
- Evidence-question quotations: all four options must be verbatim article quotations of similar length (within 2 words); the three wrong quotations must support a different claim or be true but irrelevant — they must not also support the claim.
- Q8: do not use a generic "What is the author's attitude?" stem; quote or name at least one specific wording signal and ask what it reveals about the author's stance.
```

Update the B2 Q7/Q8 blueprint lines to match (similar length, non-supporting distractors, signal-anchored stem).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (199 existing + new).

- [ ] **Step 5: Commit**

```bash
git add services/aiService.ts services/__tests__/b2QuestionQuality.test.ts
git commit -m "feat: harden B2 distractor, evidence-quote, and attitude prompt rules"
```

---

### Task 3: Pure regeneration helpers + prompt

**Files:**
- Modify: `services/aiService.ts` (export `MCSectionResponse`, add prompt builder + acceptance helpers)
- Test: `services/__tests__/mcQuestionRegeneration.test.ts`

**Interfaces:**
- Produces:
  - `buildSingleMCQuestionPrompt(article: string, difficulty: Difficulty, questionId: string, questions: MCQuestion[]): string`
  - `isRegeneratedMCQuestionAcceptable(candidate: MCQuestion, existing: MCQuestion, difficulty: Difficulty, all: MCQuestion[]): string[]` — returns reasons; empty = acceptable
  - `applyRegeneratedMCQuestion(all: MCQuestion[], candidate: MCQuestion, difficulty: Difficulty): MCQuestion[]`

Rules enforced by acceptance:
- id equals existing id; 4 options; answer A–D; non-empty explanation/question.
- slot metadata equals B2 blueprint (B2) or existing item's metadata (other levels).
- `skillTarget` non-empty; B2 reasoning slots have ≥2 evidence and ≥2 reasoning steps.
- q8 stem/skillTarget mentions attitude/tone/stance; q2 stem has no digits/percent.
- every wrong option has distractor rationale; option word counts within ±2 of the correct option.
- stem not duplicated in any other question (normalized lowercase, non-word chars collapsed).

- [ ] **Step 1: Write failing tests**

```ts
it('builds a single-slot prompt that forbids repeating the current item', () => {
  const prompt = buildSingleMCQuestionPrompt('Article', 'B2', 'q7', questions);
  expect(prompt).toContain('q7');
  expect(prompt).toContain('do not repeat');
});

it('rejects a replacement with a duplicated stem', () => {
  const candidate = { ...questions[6], id: 'q7', question: questions[2].question };
  expect(isRegeneratedMCQuestionAcceptable(candidate, questions[6], 'B2', questions))
    .toContain('duplicates another question stem');
});

it('forces slot metadata and the q6/q7 link when applying', () => {
  const candidate = { ...questions[6], type: 'Inference' as any, evidencePairLink: undefined };
  const next = applyRegeneratedMCQuestion(questions, candidate, 'B2');
  expect(next[6].type).toBe('Evidence Reasoning');
  expect(next[6].evidencePairLink).toEqual({ claimQuestionId: 'q6', evidenceQuestionId: 'q7' });
});
```

- [ ] **Step 2: Run tests, confirm failure** (functions missing)

- [ ] **Step 3: Implement helpers**

Prompt = `buildMCBatchPrompt(article, difficulty, slot, slot)` + brief:

```
IMPROVEMENT BRIEF — rewrite ONLY this item and do not repeat its wording.
Current item: <JSON of existing question>
Existing stems to avoid: <list>
Keep the assigned slot exactly. Return exactly one question with id "qX" in the same JSON schema.
```

`applyRegeneratedMCQuestion` replaces by id, forces slot metadata (B2 rules or existing), sets q6/q7 `evidencePairLink` to the canonical pair, keeps `id`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run services/__tests__/mcQuestionRegeneration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add services/aiService.ts services/__tests__/mcQuestionRegeneration.test.ts
git commit -m "feat: add single-question prompt and acceptance helpers"
```

---

### Task 4: `regenerateMCQuestion` service with bounded retries

**Files:**
- Modify: `services/aiService.ts`
- Test: `services/__tests__/mcQuestionRegeneration.test.ts`

**Interfaces:**
- Produces:
```ts
export async function regenerateMCQuestion(
  article: string,
  difficulty: Difficulty,
  questionId: string,
  questions: MCQuestion[],
  onProgress?: (message: string) => void,
  generate: (prompt: string) => Promise<{ multipleChoice?: MCQuestion[] }> = (prompt) =>
    generateJSONSection<MCSectionResponse>('Regenerating ' + questionId, prompt, getActiveConfig()!, onProgress),
): Promise<MCQuestion>
```
- Throws `new Error('Could not regenerate qX: <reasons>')` after 3 failed attempts.

Behavior: each attempt calls `generate(buildSingleMCQuestionPrompt(...) + correction)` where correction lists the previous reasons; first acceptable wins; `onProgress('Regenerating qX (attempt n/3)…')`.

- [ ] **Step 1: Write failing tests with a fake generator**

```ts
it('retries until the candidate passes', async () => {
  const bad = { ...questions[6], id: 'q7', evidence: ['one'] };
  const good = { ...questions[6], id: 'q7', question: 'A fresh evidence question?' };
  const calls: string[] = [];
  const fake = async (prompt: string) => { calls.push(prompt); return { multipleChoice: [calls.length === 1 ? bad : good] }; };
  const result = await regenerateMCQuestion('Article', 'B2', 'q7', questions, undefined, fake);
  expect(result.question).toBe('A fresh evidence question?');
  expect(calls).toHaveLength(2);
});

it('throws after three failed attempts', async () => {
  const fake = async () => ({ multipleChoice: [] });
  await expect(regenerateMCQuestion('Article', 'B2', 'q7', questions, undefined, fake)).rejects.toThrow(/Could not regenerate q7/);
});
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement loop** (max 3; reasons from `isRegeneratedMCQuestionAcceptable`; correction text appended).

- [ ] **Step 4: Run tests**

Run: `npx vitest run services/__tests__/mcQuestionRegeneration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/aiService.ts services/__tests__/mcQuestionRegeneration.test.ts
git commit -m "feat: regenerate a single MCQ with bounded retries"
```

---

### Task 5: Editor ↻ button + App wiring + Undo

**Files:**
- Modify: `components/TestPreview.tsx` (props + button)
- Modify: `App.tsx` (state, handler, Undo banner, pass props)

**Interfaces:**
- `TestPreview` gains `onRegenerateQuestion?: (id: string) => void` and `regeneratingQuestionId?: string | null`.
- App state: `regeneratingQuestionId`, `regeneratedNotice: { id: string; previousData: WorksheetData } | null`.

Behavior:
- Button rendered only in editor view, before/after the number badge, disabled while any regeneration is running.
- Handler replaces the item, updates `keys.mc[id]` from the new answer, re-runs `validateWorksheet` + `scopeValidationResult`, and stores the pre-change `data` for Undo.
- Undo restores the snapshot and clears the notice.
- Errors surface through the existing `error` banner; worksheet unchanged.

- [ ] **Step 1: Wire TestPreview props and button** (no test; verified by tsc + build)
- [ ] **Step 2: Wire App handler/Undo**
- [ ] **Step 3: Run `npx tsc --noEmit` and `npm test`**
- [ ] **Step 4: Commit**

```bash
git add components/TestPreview.tsx App.tsx
git commit -m "feat: regenerate a single MCQ from the editor with undo"
```

---

### Task 6: Verify, deploy, document

- [ ] **Step 1:** `npm test` (expect ≥201), `npx tsc --noEmit`, `npm run build`
- [ ] **Step 2:** Local smoke: `npx vite preview --port 4173`, Playwright/Edge load, click-free UI check
- [ ] **Step 3:** `npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main`; verify live HTML references the new `assets/index-*.js`
- [ ] **Step 4:** Update `PROJECT_STATUS.md` (live version/source/JS, feature, tests, log rows), commit, `git push origin main`
