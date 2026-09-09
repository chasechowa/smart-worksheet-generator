# PROJECT STATUS — Smart Worksheet Generator

> **本文件的作用**：记录本项目的「当前状态 + 部署/上线轨迹 + 待办」。
> 任何 agent（Claude / Codex / 其他）进入本文件夹后，先读这份文件即可接手，无需重新考古。
> **约定**：每次 `git` 操作或 CF 部署后，请在末尾【操作日志】追加一行 —— 让轨迹留在本地。

最后更新：**2026-09-09**

---

## 1. 一句话现状

**线上已部署到 CF（`comprequiz.chao.asia`）：DeepSeek V4 生成已修复，B2 summary 现已强制恰好 5 个有效空位 + 自动重试（≤3 次），已上线。**
本地与远程已同步（`ea9e4c8`）。CF 更新是**手动 wrangler 部署**，不依赖 GitHub push。

---

## 2. 项目身份 & 运行环境

- 名称：`smart-worksheet-generator`（AI 阅读理解试卷生成器，ESL/EFL 教学用）
- GitHub 仓库：`chasechowa/smart-worksheet-generator`（remote = `origin`，HTTPS）
- 分支：默认/当前 `main`。本地 HEAD `349625c` + 未提交的 Codex 改动。
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

- 最新 CF 部署：**`038871c0`**（source `349625c`），Production / `main`
- 线上 serving：`dist/index-BMLCgdKj.js`（当前 build）
- 验证线上版本：`curl -s -H 'Cache-Control: no-cache' https://comprequiz.chao.asia/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'`
  - 若结果 ≠ 本地 `grep -oE 'assets/index-.*\.js' dist/index.html`，说明 CDN 边缘缓存了旧 HTML，**强刷 / 用 curl 加 `Cache-Control: no-cache`** 即可（见【缓存注意】）。
- 上一版部署：`b552e062`（`835d5bd`）；再之前 `bac7de3d`（`dcbbb9c`）、2 个月前的 `2a39a76`。

---

## 5. Git 状态 & 轨迹

- 本地 HEAD：`ea9e4c8` — `fix: make B2 summary strictly 5 valid blanks with auto-retry`
- 远程 `main`：已与本地同步（`ea9e4c8`），push 成功 `dcbbb9c..ea9e4c8`
- `ea9e4c8` 内容（Codex 的 summary 稳定性修复）：`aiService.ts` 新增 `isCompleteSummary()`、Summary 失败只重生成（≤3 次）、代理超时 120s、修提示词示例；`summaryValidator.ts`(+测试) 与 `summaryRepair.test.ts` 校验答案非空/不重复/原文可定位。
- 历史：`349625c`(docs) → `835d5bd`(V4 + summary 精修) → `dcbbb9c`(移除 Electron)

---

## 6. 最近改动（commit 内容速记）

- **`038871c0`（线上，source `349625c`）— B2 Summary 稳定性**：强制恰好 5 空 5 答案；答案非空/不重复/原文可定位；不合格只重生成 Summary（≤3 次）；3 次仍失败则明确报错、不回退到不完整结果；修正提示词示例。146/146 测试通过。
- `835d5bd`（已部署 `b552e062`）— **DeepSeek V4 生成修复 + summary 精修**：deepseek 关闭 thinking、max_tokens 32k、配置连接走代理；summary 提示词强制内联 `[BLANK]`、新增 `repairSummary()` 兜底。
- `dcbbb9c`（已部署 `bac7de3d`）— **移除 Electron，纯 web/Cloudflare 版**：删 `electron/`、`release/`，裁剪依赖，`aiService`/`storageService` 只走 CF Worker 代理 + localStorage；PDF 导出改浏览器打印。
- 更早：C1 校验规则对齐、试卷导出设计打磨等。

---

## 7. 关键配置（AI / 模型）

DeepSeek 现网有效模型（**其他 id 如 `deepseek-chat`/`deepseek-reasoner` 已作废**，加载时自动校正为 `deepseek-v4-pro`）：
- `deepseek-v4-pro`（默认）
- `deepseek-v4-flash`
- `deepseek-v4-flash-vision-exp`

接口：
- OpenAI 兼容 base_url：`https://api.deepseek.com`（走 `/chat/completions`）
- Anthropic 兼容 base_url：`https://api.deepseek.com/anthropic`（本项目用不到）
- API 代理：`getUserProxy`(localStorage `vocabforge_custom_proxy`) → `https://api.comprequiz.chao.asia` → `https://smart-worksheet-proxy.saberking8.workers.dev` → 直连兜底

---

## 8. 验证 / 测试

- 测试：`npm test`（vitest）。最近一次 **146/146 通过**（11 个文件）。
- 构建：`npm run build`（先 `build:css` 再 vite 打包到 `dist/`）。Producer build 通过。
- 校验逻辑：`validators/`（summary/mc/syntax/writing/keys 分模块），`services/validatorService.ts` 调用 `validateAll()`。

---

## 9. 缓存注意（线上验证常见坑）

CF Pages 自定义域名走 Cloudflare CDN。**刚部署完，边缘可能缓存旧 `index.html`**，导致线上 JS hash 与最新部署不一致：
- 用 `curl -s -H 'Cache-Control: no-cache' https://comprequiz.chao.asia/` 可绕过。
- 浏览器验证请 **Ctrl+F5 强刷**。

---

## 10. 未完成 / 待办

- [ ] 可选：MC 选项长度差异、syntax 原文连续性的警告（不属于 summary，未处理）
- [ ] 可选：给 `worker/` 加一个 `deploy:worker` 脚本 / 文档化 CF Pages 流程

---

## 11. 操作日志（本地痕迹，每次追加一行）

| 时间 | 动作 | 结果 |
| --- | --- | --- |
| 2026-09-09 | Codex：B2 Summary 稳定性修复（严格 5 空 5 答案、原文可定位、失败仅重生成 Summary ≤3 次、修提示词示例）；部署 CF Pages | ✅ 146/146；部署 `038871c0`，线上 `index-BMLCgdKj.js` |
| 2026-09-09 | 我已核验线上 `index-BMLCgdKj.js`、部署 `038871c0`、测试 146/146 | ✅ 与 Codex 报告一致 |
| 2026-09-09 | 提交 Codex 改动 + 同步本文件 → `ea9e4c8`，并 `git push origin main` | ✅ `dcbbb9c..ea9e4c8`，远程已同步 |
| 2026-09-09 | 新增 `AGENTS.md`（Codex 自动加载的协调规则，与 CLAUDE.md 同源，均指向本文件） | 本地 OK |
| 2026-09-06 | commit `835d5bd`（V4 修复 + summary 精修） | 本地 OK |
| 2026-09-06 | `git push origin main`(835d5bd) | ❌ 当时网络连不上 github.com:443 |
| 2026-09-06 | `wrangler pages deploy dist` | ✅ 部署 `b552e062`，线上 `index-Bwx-HLLi.js` |
| 2026-09-06 | commit `dcbbb9c`（移除 Electron）+ 部署 `bac7de3d` | ✅ 曾成功 push `96a8798..dcbbb9c` |
| 2026-09-07 | docs: `PROJECT_STATUS.md` / `CLAUDE.md` 增补 + 同步（`1a88755`,`1815b53`,`349625c`） | 本地 OK |
