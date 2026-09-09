# Agent Coordination — Smart Worksheet Generator

This file is loaded automatically by agent tooling (Codex reads `AGENTS.md`; Claude reads
`CLAUDE.md`). Both point at the same single source of truth so that either agent can pick up
the project state and finish the other's work without conflicts.

## 1. Always read first

Read **`PROJECT_STATUS.md`** before touching anything. It holds the current state, the live
Cloudflare deployment/version, the git trace, recent work, and open todos. A fresh agent must be
able to reconstruct the whole project from it alone.

## 2. Keep it in sync (mandatory)

After ANY material change (feature, config, model list, deployment, live version, push outcome):
- update the relevant **state sections** of `PROJECT_STATUS.md`, not just the log;
- append one line to its **【操作日志】** table.

After every `git` operation or Cloudflare deploy, append a log line too. This file is the
canonical handoff — leaving it stale breaks the next agent.

## 3. Deployment model (critical — don't get fooled)

- CF Pages project `smart-worksheet-generator` → `comprequiz.chao.asia`.
- **Git Provider = No.** The Pages project is NOT git-connected. **Pushing to GitHub does NOT
  deploy.** Deployment is manual:
  ```bash
  npm run build   # outputs dist/
  npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main
  ```
- CF account: `saberking8@gmail.com` / Account ID `23104164c8b023e09beff37879e305f4` (wrangler authed).

## 4. Concurrency rule (avoids breakage)

If the other agent may be working in the same working tree, do NOT run `wrangler pages deploy` or
rebuild `dist` while it is mid-edit — that caused a build/deploy race before. Coordinate: wait
until the other agent reports done, or confirm they are idle, before deploying.

## 5. Git rules (keep the history clean & safe)

- **Stage specific files** (`git add <path>...`), never `git add .` / `git add -A`.
  This avoids sweeping `.claude/` (contains credentials) and `.npm-cache/` into commits.
- Commit on the current branch `main`. Aim for small, focused commits; after each, update the
  status-file log.
- Push when the network allows. Remote `origin` = `chasechowa/smart-worksheet-generator` (HTTPS).

## 6. AI / model facts

DeepSeek valid models: `deepseek-v4-pro` (default), `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`.
Stale ids (`deepseek-chat`, `deepseek-reasoner`) are dead and auto-healed to the default. DeepSeek
generation must run with thinking disabled and a large `max_tokens`.

## 7. Verification + close-out

Before claiming done: `npm test`, `npm run build`, then (if it should ship) `wrangler pages deploy`,
then update `PROJECT_STATUS.md`, commit, and push.
