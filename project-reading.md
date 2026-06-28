# Project Reading

Last read: 2026-06-28

## Snapshot

This project is **Smart Worksheet Generator**, an AI-powered reading worksheet generator for ESL/EFL reading practice. It can run as:

- A Vite/React web app.
- An Electron desktop app.
- A Cloudflare-hosted frontend with a Cloudflare Worker API proxy.

The current branch is `main`, tracking `origin/master`, and local history is ahead by 3 commits. There are existing untracked Claude Code / validator files that should be treated as someone else's active work unless explicitly handed over.

## Stack

- React 19 + TypeScript + Vite.
- Tailwind CSS for exported worksheet styling.
- Electron 35 for desktop packaging and local file/PDF capabilities.
- Vitest for unit tests.
- Cloudflare Worker proxy in `worker/`.

Key scripts from `package.json`:

```bash
npm run dev
npm run build
npm test
npm run preview
npm run electron:dev
npm run electron:build
```

## Product Model

The app turns an article into a printable worksheet with:

- Summary completion.
- Multiple choice questions.
- Syntax deconstruction.
- Writing and logic workshop.
- Answer keys.

Difficulty levels are `A2`, `B1`, `B2`, and `C1`. The difficulty-specific constraints live in `services/difficultyProfiles.ts` and drive prompt construction in `services/aiService.ts`.

## Core Flow

1. `App.tsx` owns UI state, article input, difficulty, generation, preview/export modes, project state, validation display, and PDF/HTML export handling.
2. `services/aiService.ts` builds the prompt, calls the active AI provider, parses JSON, and optionally runs refinement. `MAX_REFINEMENT_ROUNDS` is currently `0`, so the app relies on prompt quality plus mechanical validation fixes.
3. `services/configService.ts` stores provider configuration in `localStorage` under `vocabforge_ai_keys`.
4. `services/validatorService.ts` calls `validateAll()` and attaches validation metadata.
5. `validators/index.ts` runs the section validators.
6. `components/TestPreview.tsx` renders the generated worksheet in editor, print, compact print, and interactive modes.

## AI Providers And Proxying

Supported providers are defined in `types.ts`:

- Gemini.
- DeepSeek.
- Kimi.
- Custom OpenAI-compatible endpoint.

Browser API calls go through proxy fallback order in `services/aiService.ts`:

1. User custom proxy from `localStorage` key `vocabforge_custom_proxy`.
2. `https://api.comprequiz.chao.asia`.
3. `https://smart-worksheet-proxy.saberking8.workers.dev`.
4. Direct fetch fallback.

Electron API calls go through IPC:

- Renderer: `electron/preload.cjs`.
- Main process handler: `electron/main.cjs`.
- Proxy-aware fetch: `fetchWithProxy()`.

Cloudflare Worker proxy:

- Config: `worker/wrangler.toml`.
- Entry: `worker/api-proxy.js`.
- Worker name: `smart-worksheet-proxy`.
- Public frontend CNAME: `public/CNAME` contains `comprequiz.chao.asia`.

## Persistence

Web mode stores projects in browser `localStorage`.

Electron mode stores projects through IPC into:

```text
D:\WorkingStuff\TOOLS
```

This path is hardcoded in `electron/main.cjs` as `PROJECTS_DIR`.

## Validation

Validation is split by section:

- `validators/summaryValidator.ts`
- `validators/mcValidator.ts`
- `validators/syntaxValidator.ts`
- `validators/writingValidator.ts`
- `validators/keysValidator.ts`
- `validators/verbatimMatcher.ts`

`validators/mcValidator.ts` performs several important auto-fixes:

- Strips option prefixes like `A.`.
- Converts answer text into answer letters where possible.
- Rotates options to improve answer distribution.
- Rebuilds MC answer keys after rotation.
- Migrates old MC question types.

There is an untracked `validators/c1Validator.ts` plus test file. It appears intended to enforce stricter C1 MC boundaries, but it is not currently wired into `validators/index.ts` or `validators/mcValidator.ts`.

## Known Current State

Commands run during this read:

```bash
npm test
npm run build
```

Results:

- Tests passed: 10 test files, 124 tests.
- Production build passed.
- Build warnings:
  - Browserslist/caniuse-lite is outdated.
  - Main JS chunk is slightly above Vite's 500KB warning threshold.
  - `validators/index.ts` is both dynamically and statically imported, so dynamic import will not split that module into a separate chunk.

Git state observed before this document:

- `main...origin/master [ahead 3]`.
- Untracked:
  - `.claude/`
  - `validators/c1Validator.ts`
  - `validators/__tests__/c1Validator.test.ts`

Important safety note: `.claude/settings.local.json` contains local permissions and appears to include sensitive historical credential text. Do not commit it, quote it, or copy it into documentation.

## Deployment Notes

Frontend build:

```bash
npm run build
```

Local preview:

```bash
npm run preview
```

Worker deployment should be run from `worker/` with Wrangler credentials available:

```bash
npx wrangler deploy
```

There is no explicit `deploy` script in `package.json`. If Claude Code is currently auto-syncing deployments after modifications, that deployment behavior is outside the visible npm scripts and may be configured in Cloudflare Pages, Wrangler auth/session state, or Claude Code's local workflow.

Suggested handoff rule:

- For frontend code changes: run `npm test`, `npm run build`, then let the configured Cloudflare sync/deploy path publish `dist/`, or deploy through the existing CF Pages setup if available.
- For Worker changes: run or request `npx wrangler deploy` from `worker/`.
- For doc-only changes: no app deployment is necessary.

## How I Should Work Here

For normal changes:

1. Check `git status --short --branch`.
2. Read the relevant component/service/validator before editing.
3. Preserve unrelated Claude Code work and untracked files unless asked to include them.
4. Edit with a narrow scope.
5. Run targeted tests, then `npm test` and `npm run build` when reasonable.
6. Deploy only when the change affects shipped app/Worker behavior and credentials are available.
7. Commit only the files intentionally changed for the task.

For git:

```bash
git add <specific-files>
git commit -m "<type>: <summary>"
git push
```

Because the local branch is `main` while the upstream shown by git is `origin/master`, confirm push target before pushing if the branch setup changes.

## High-Risk Areas

- Prompt text in `services/aiService.ts` is long and partly mojibake in the terminal, so use careful UTF-8-aware editing and test JSON output expectations.
- Config UI in `components/ConfigPanel.tsx` contains visible mojibake strings and one suspicious malformed-looking JSX span in terminal output; verify before touching.
- Answer rotation in `validators/mcValidator.ts` changes option order and answer keys, so MC changes need focused tests.
- Electron storage writes outside the repo to `D:\WorkingStuff\TOOLS`.
- Worker proxy passes through API authorization headers, so avoid logging secrets.

## Immediate Improvement Candidates

- Wire the untracked C1 validator into MC validation if it is intended to ship.
- Add a `deploy:worker` script for `cd worker && wrangler deploy` or document the exact Cloudflare Pages workflow.
- Fix mojibake in README/UI strings if the source files are actually encoded incorrectly rather than only rendered incorrectly by PowerShell.
- Consider code splitting if bundle size grows further.
