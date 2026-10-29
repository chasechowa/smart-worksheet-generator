# Agent Coordination — Smart Worksheet Generator

This file is loaded automatically by agent tooling (Codex reads `AGENTS.md`; Claude reads
`CLAUDE.md`). Both point at the same single source of truth so that either agent can pick up
the project state and finish the other's work without conflicts.

## 0. Read SKILL.md first (mandatory)

Before anything else, read **`SKILL.md`**. It defines the two workstreams — **UI** (workspace
shell/theme/responsive) and **LOGIC-PDF** (generation logic, validators, worksheet paper, print/PDF
layout) — plus file ownership, shared-file locks, deploy permissions, and definition of done.
Then read `PROJECT_STATUS.md` §0 for the live locks; confirm which stream this conversation owns
before editing. If the conversation was opened in the UI worktree, follow `SKILL.md` §3.

## 1. Always read first

Read **`SKILL.md`** and then **`PROJECT_STATUS.md`** before touching anything. The status file holds
the current state, the live Cloudflare deployment/version, the git trace, recent work, and open
todos. A fresh agent must be able to reconstruct the whole project from it alone.

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

Two conversations may run at once: the **UI** stream works in a separate worktree
(`../smart-worksheet-generator-ui`, branch `ui/overhaul`) and may only deploy previews
(`--branch ui/overhaul`). The **LOGIC-PDF** stream works in this tree on `main` and owns production
deployments (`--branch main`). Shared files (`App.tsx`, `index.html`, `package.json`, docs) require
holding the matching lock in `PROJECT_STATUS.md` §0. Never rebuild `dist/` or run
`wrangler pages deploy` while another stream is mid-edit. Full rules: `SKILL.md` §3–§4.

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
