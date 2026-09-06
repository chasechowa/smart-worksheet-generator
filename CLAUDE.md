# Project — Smart Worksheet Generator

Read **`PROJECT_STATUS.md`** first: it holds the current state, CF deployment/live status,
git trace, recent work, and open todos. Keep it updated — after any `git` operation or
Cloudflare deploy, append one line to its【操作日志】section.

Key facts (details in PROJECT_STATUS.md):

- Pure web app (Electron was removed). Deployed via Cloudflare Pages **manually**
  (`npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main`),
  → `comprequiz.chao.asia`. Pages project is NOT git-connected, so GitHub pushes do NOT deploy.
- Repo: `chasechowa/smart-worksheet-generator`, branch `main`. `origin` is HTTPS GitHub.
- DeepSeek valid models: `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`.
- Run: `npm test`, `npm run build`, deploy per PROJECT_STATUS.md.
