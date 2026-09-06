# PROJECT STATUS — Smart Worksheet Generator

> **本文件的作用**：记录本项目的「当前状态 + 部署/上线轨迹 + 待办」。
> 任何 agent（Claude / Codex / 其他）进入本文件夹后，先读这份文件即可接手，无需重新考古。
> **约定**：每次 `git` 操作或 CF 部署后，请在末尾【操作日志】追加一行 —— 让轨迹留在本地。

最后更新：**2026-09-06**

---

## 1. 一句话现状

**线上已部署到 CF（`comprequiz.chao.asia`），DeepSeek V4 生成已修复、summary 出题已精修。**
本地提交：`1a88755`（= `835d5bd` 代码 + 本状态文档），**领先远程 2 个 commit，还没推到 GitHub**（网络连不上 github.com:443）。CF 更新是**手动 wrangler 部署**，不依赖 GitHub push。

---

## 2. 项目身份 & 运行环境

- 名称：`smart-worksheet-generator`（AI 阅读理解试卷生成器，ESL/EFL 教学用）
- GitHub 仓库：`chasechowa/smart-worksheet-generator`（remote = `origin`，HTTPS）
- 分支：默认/当前 `main`。本地 `main` ← **ahead by 1**（`835d5bd`）
- 技术栈：React 19 + TS + Vite + Tailwind，纯 web（**Electron 已彻底移除**）
- API 代理：Cloudflare Worker（`worker/api-proxy.js` + `worker/wrangler.toml`，Worker 名 `smart-worksheet-proxy`）
- 存储：浏览器 `localStorage`（key `worksheet_projects`）；AI 配置在 localStorage key `vocabforge_ai_keys`

---

## 3. 部署模型（重点，别被误导）

- CF Pages 项目：**`smart-worksheet-generator`**，域名 `comprequiz.chao.asia` + `smart-worksheet-generator.pages.dev`
- ⚠️ **Git Provider = No** —— Pages 项目**没有接 GitHub 自动部署**。你推 GitHub 不会触发构建。
- 所以上线 = **手动部署**：
  ```bash
  npm run build   # 产出 dist/
  npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main
  ```
- CF 账号：`saberking8@gmail.com` / Account ID `23104164c8b023e09beff37879e305f4`（wrangler 已登录）
- 同一账号下还有一个 `vocabforge-ai` 项目（`vocabforge-ai.chao.asia`），与本项目同级、独立。

---

## 4. 当前线上状态

- 最新 CF 部署：**`b552e062`**（source commit `835d5bd`），Production / `main`
- 线上 serving：`dist/index-Bwx-HLLi.js`（本项目当前 build）
- 验证线上版本：`curl -s https://comprequiz.chao.asia/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'`
  - 若结果 ≠ 本地 `grep -oE 'assets/index-.*\.js' dist/index.html`，说明 CDN 边缘缓存了旧 HTML，**强刷 / 用 curl 加 `Cache-Control: no-cache`** 即可（见下方【缓存注意】）。
- 上一版部署：`bac7de3d`（commit `dcbbb9c`）。再之前是 2 个月前的 `2a39a76`。

---

## 5. Git 状态 & 轨迹

- 本地 HEAD：见下方 git log（本地 `main` 领先远程，远程停在 `dcbbb9c`）
  - `835d5bd` — DeepSeek V4 生成修复 + summary 精修
  - `dcbbb9c` — 移除 Electron
- 远程 `main`：`dcbbb9c`（本地领先若干 commit **尚未 push**，网络连不上 github.com，见【操作日志】）
- ⚠️ 最近 `git push` 持续失败：`Failed to connect to github.com:443 / Connection reset`（当前网络到 GitHub 不通，时好时坏）。**待办：网络恢复后推一次。**
- 最后成功 push：`96a8798..dcbbb9c  main -> main`

---

## 6. 最近改动（commit 内容速记）

- `835d5bd`（未推送）— **DeepSeek V4 生成修复 + summary 精修**：
  - Codex 接口修复：deepseek **关闭 thinking 模式**（V4 默认 thinking 会污染 JSON）；`max_tokens` 提到 32k；配置面板测试连接走内置代理。
  - summary：提示词强制内联 `[BLANK]` + 自检计数；新增 `repairSummary()` 兜底（段落缺 `[BLANK]` 时逐字注入，保证 paragraph/blanks/keys 数量一致）。
- `dcbbb9c`（已推送 + 已部署）— **移除 Electron，纯 web/Cloudflare 版**：删 `electron/`、`release/`，裁剪依赖，`aiService`/`storageService` 只走 CF Worker 代理 + localStorage；PDF 导出改为浏览器打印。
- 更早：C1 校验规则对齐、试卷导出设计打磨等。

---

## 7. 关键配置（AI / 模型）

DeepSeek 现网有效模型（**其他 id 如 `deepseek-chat`/`deepseek-reasoner` 已作废**，加载时会自动校正为 `deepseek-v4-pro`）：
- `deepseek-v4-pro`（默认）
- `deepseek-v4-flash`
- `deepseek-v4-flash-vision-exp`

接口：
- OpenAI 兼容 base_url：`https://api.deepseek.com`（走 `/chat/completions`）
- Anthropic 兼容 base_url：`https://api.deepseek.com/anthropic`（本项目用不到）
- API 代理：`getUserProxy`(localStorage `vocabforge_custom_proxy`) → `https://api.comprequiz.chao.asia` → `https://smart-worksheet-proxy.saberking8.workers.dev` → 直连兜底

---

## 8. 验证 / 测试

- 测试：`npm test`（vitest）。最近一次 142/142 通过。
- 构建：`npm run build`（会先 `build:css` 再用 vite 打包到 `dist/`）。
- 校验逻辑：`validators/`（summary/mc/syntax/writing/keys 分模块），`services/validatorService.ts` 调用 `validateAll()`。

---

## 9. 缓存注意（线上验证常见坑）

CF Pages 自定义域名走 Cloudflare CDN。**刚部署完，边缘可能缓存旧 `index.html`**，导致线上显示的 JS hash 与最新部署不一致：
- 用 `curl -s -H 'Cache-Control: no-cache' https://comprequiz.chao.asia/` 可绕过。
- 浏览器验证请 **Ctrl+F5 强刷**。

---

## 10. 未完成 / 待办

- [ ] **push `835d5bd` 到 GitHub**（网络恢复后；`git push origin main`）
- [ ] 可选：MC 选项长度差异、syntax 原文连续性的警告（不属于 summary，未处理）
- [ ] 可选：给 `worker/` 加一个 `deploy:worker` 脚本 / 文档化 CF Pages 流程

---

## 11. 操作日志（本地痕迹，每次追加一行）

| 时间 | 动作 | 结果 |
| --- | --- | --- |
| 2026-09-06 | commit `835d5bd`（V4 修复 + summary 精修） | 本地 OK |
| 2026-09-06 | `git push origin main`(835d5bd) | ❌ 网络连不上 github.com:443 |
| 2026-09-06 | `wrangler pages deploy dist` | ✅ 部署 `b552e062`，线上 `index-Bwx-HLLi.js` |
| 2026-09-06 | commit `dcbbb9c`（移除 Electron）+ 部署 `bac7de3d` | ✅ 曾成功 push `96a8798..dcbbb9c` |
| 2026-09-06 | docs: 新增 `PROJECT_STATUS.md` / `CLAUDE.md`（`1a88755`, `1815b53`） | 本地 OK |
