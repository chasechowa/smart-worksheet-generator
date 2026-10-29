# Project — Smart Worksheet Generator

**Read `SKILL.md` first (mandatory).** It assigns this conversation to one of two streams —
**UI** (workspace shell/theme/responsive) or **LOGIC-PDF** (generation logic, validators, worksheet
paper, print/PDF layout) — and defines file ownership, shared-file locks, deploy permissions, and
done criteria. Then read `PROJECT_STATUS.md` §0 for the live locks before editing anything.

Read **`PROJECT_STATUS.md`** next: it holds the current state, CF deployment/live status,
git trace, recent work, and open todos. **Keep it in sync as you work** — after any material
change (feature, config, model list, deployment, live version, push outcome) update the relevant
sections too, not just the log. After any `git` operation or Cloudflare deploy, append one line
to its 【操作日志】 section. This file is the project's canonical handoff; a fresh agent must be
able to pick up the current state from it alone.

Key facts (details in PROJECT_STATUS.md):

- Pure web app (Electron was removed). Deployed via Cloudflare Pages **manually**
  (`npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main`),
  → `comprequiz.chao.asia`. Pages project is NOT git-connected, so GitHub pushes do NOT deploy.
- Repo: `chasechowa/smart-worksheet-generator`, branch `main`. `origin` is HTTPS GitHub.
- DeepSeek valid models: `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`.
- Run: `npm test`, `npm run build`, deploy per PROJECT_STATUS.md.
