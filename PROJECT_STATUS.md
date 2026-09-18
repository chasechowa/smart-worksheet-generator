# PROJECT STATUS — Smart Worksheet Generator

最后更新：**2026-09-10**

## 1. 当前状态

`comprequiz.chao.asia` 现运行纯出题版本 `219c266f`（source `3621eef`；JS `index-ZPhA0dBV.js`）。**Summary 现在保证恰好 5 个空**（模型给不够时机械补空兜底），且 B2 生成不再硬失败。个人工作台已从本仓库移出，恢复单入口 Vite 配置；本次是在**重新构建**后的纯出题产物上发布（未再发布工作台）。

**用户纠正：个人工作台必须是独立网站，先只在本地开发；等用户给独立地址后再用 CF 部署。不得再次将工作台发布到本项目。**

## 2. 项目与运行环境

- 仓库：`chasechowa/smart-worksheet-generator`，分支 `main`。
- React 19 + TypeScript + Vite + Tailwind，纯 Web。
- 出题存储：localStorage `worksheet_projects`；AI 配置 `vocabforge_ai_keys`。
- Worker：`worker/api-proxy.js`、`worker/wrangler.toml`，`smart-worksheet-proxy`。
- 工作台独立目录：`D:/ChatGPT/WorkingInterface`，不在本仓库内；拥有自己的 package.json、锁文件、src、构建、说明与状态文档。
- 工作台本地地址：`http://127.0.0.1:3100/`；没有绑定域名和 CF 项目，也不推送到本出题仓库。

## 3. 部署约定

- CF Pages `smart-worksheet-generator` → `comprequiz.chao.asia`。
- Git Provider = No，Git push 不会部署。
- 本项目发布命令：`npm run build`，然后 `npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main`。
- CF Account ID：`23104164c8b023e09beff37879e305f4`；Wrangler 已登录。
- 同工作树有其他代理时，不并发重建 dist 或部署。
- 本次发现其他 Claude 进程，采用 CF 历史回滚及独立验证输出目录，没有重建共享 dist 或重新上传。
- 发布前**必须重新 `npm run build`**，并确认产物是单入口纯出题（`dist/` 内无 `workbench.html`）。2026-09-18 已在重新构建后发布 `1cc38f01`。

## 4. 当前线上版本

- 生产 canonical deployment：`219c266f`（source `3621eef`，纯出题 + B2 优雅降级 + **5 空保证**）。
- 主站 JS：`assets/index-ZPhA0dBV.js`。已用 cache-bypass 核验线上与本地 dist 一致。上一版 `1cc38f01`（JS `index-BiK__d3x.js`）；再之前回滚版 `5192e2c3`（source `aefadb6`，JS `index-Bz4XWNgl.js`）。
- `/workbench.html` 与带新查询参数的 `/workbench` 已返回原出题应用（SPA 回退），不是工作台。
- 裸 `/workbench` 在本次探测仍命中旧缓存；精确 URL 缓存清除 API 返回 10000 Authentication error（现有 OAuth 缺少权限）。生产回滚已独立核实成功，旧缓存需刷新/过期。
- 错误历史部署 `484f6bf7`、`e1b25309` 已不作为生产版本，但历史预览仍保留。自动审批拒绝永久删除历史记录，已采用安全回滚完成线上恢复，不再尝试删除。

## 5. Git 状态

- 本次起始 HEAD `1ff2164`，此前工作台代码提交 `0bfccaa`、`1463e4e`。
- 本次移除 workbench/、workbench.html、WORKBENCH_PLAN.md，并恢复 vite.config.ts 单入口；复制文件已逐一验证。
- 网络已恢复并成功 push：`1ff2164..b1b5d17`，远程 `main` 与本地同步（HEAD `b1b5d17`）。
- `.claude/` 未跟踪，绝不可暂存或输出其凭据内容。

## 6. 出题功能与配置

- B2 共享文章证据地图；Summary **保证恰好 5 个空**（`ensureFiveBlanks`：模型给不够时，从原文中逐字可查的短语里机械补空，长短语优先、再单词，去重且 ≤maxBlankWords）；MCQ 固定十题蓝图。
- **生成不再硬失败**：证据地图 / Summary / MC 重试用尽后返回 best-effort（问题以警告呈现），不再整份丢弃。
- DeepSeek 默认 `deepseek-v4-pro`，可选 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`；旧 ID 自动修复。生成关闭 thinking，max_tokens 32k。
- 代理顺序：用户自定义 → `https://api.comprequiz.chao.asia` → `https://smart-worksheet-proxy.saberking8.workers.dev` → 直连。

## 7. 本次验证

- 出题项目：150/150 测试通过；`npm run build -- --outDir .npm-cache/worksheet-restored-dist` 通过，产物 `index-Bz4XWNgl.js` 与回滚版本一致。
- 独立工作台：11/11 测试、TypeScript 检查和独立生产构建通过；本地首页与组件编译 HTTP 200。
- 未运行浏览器交互/截图测试。

## 8. 后续

- 工作台后续仅在独立目录开发，遵守其中 AGENTS.md 与 README.md；等用户指定地址后才部署。
- 工作台数据按浏览器来源隔离，原网址数据不会自动迁移，需备份导入导出。
- 出题可选优化：MC 选项长度、syntax 原文连续性警告，以及 Worker 部署脚本。

## 11. 操作日志（本地痕迹，每次追加一行）

| 时间 | 动作 | 结果 |
| --- | --- | --- |
| 2026-09-09 | B2 深度阅读改造：文章证据地图、Summary 五类覆盖、固定 MCQ 蓝图、B2 证据链硬校验与批次局部重生成；commit `aefadb6`；部署 CF Pages | ✅ 150/150；部署 `5192e2c3`，线上 `index-Bz4XWNgl.js` |
| 2026-09-09 | Codex：B2 Summary 稳定性修复（严格 5 空 5 答案、原文可定位、失败仅重生成 Summary ≤3 次、修提示词示例）；部署 CF Pages | ✅ 146/146；部署 `038871c0`，线上 `index-BMLCgdKj.js` |
| 2026-09-09 | 我已核验线上 `index-BMLCgdKj.js`、部署 `038871c0`、测试 146/146 | ✅ 与 Codex 报告一致 |
| 2026-09-09 | 提交 Codex 改动 + 同步本文件 → `ea9e4c8`，并 `git push origin main` | ✅ `dcbbb9c..ea9e4c8`，远程已同步 |
| 2026-09-09 | 新增 `AGENTS.md`（Codex 自动加载的协调规则，与 CLAUDE.md 同源，均指向本文件） | 本地 OK |
| 2026-09-06 | commit `835d5bd`（V4 修复 + summary 精修） | 本地 OK |
| 2026-09-06 | `git push origin main`(835d5bd) | ❌ 当时网络连不上 github.com:443 |
| 2026-09-06 | `wrangler pages deploy dist` | ✅ 部署 `b552e062`，线上 `index-Bwx-HLLi.js` |
| 2026-09-06 | commit `dcbbb9c`（移除 Electron）+ 部署 `bac7de3d` | ✅ 曾成功 push `96a8798..dcbbb9c` |
| 2026-09-07 | docs: `PROJECT_STATUS.md` / `CLAUDE.md` 增补 + 同步（`1a88755`,`1815b53`,`349625c`） | 本地 OK |

| 2026-09-10 | 读取 git status 与最近提交：HEAD 6319f10，仅 .claude/ 未跟踪；新增个人工作台计划与独立页面骨架 | 原出题页面保留，工作台开发中 |
| 2026-09-10 | git diff --stat / status 检查；工作台初版验证 | 161/161 测试、类型检查与生产构建通过；原出题源码未改，待部署 |
| 2026-09-10 | 使用现有 Wrangler 4.129.0 执行 CF Pages 部署；检查未发现 Claude 进程 | 9 个资源上传完成，等待发布结果 |
| 2026-09-10 | CF Pages 部署完成 484f6bf7 | 工作台与出题页双入口已发布，待提交和 push |
| 2026-09-10 | git add 指定工作台文件、计划、构建配置与状态文档 | 暂存成功；未包含 .claude/ 或缓存 |
| 2026-09-10 | git add 状态文档并 commit 0bfccaa | 工作台初版已提交；补充手机端设置入口与拖放默认行为保护 |
| 2026-09-10 | 补充手机端设置入口及拖放保护，再次运行 161 项测试和构建，执行 CF Pages 部署 | 验证通过，等待最终部署地址 |
| 2026-09-10 | 最终 CF 部署 e1b25309 完成 | 工作台 workbench-dwNbBPJc.js；原出题资源 worksheet-DLOi_EZb.js |
| 2026-09-10 | git add 指定修复文件并 commit 1463e4e；git push origin main | 成功 a473eb5..1463e4e；全部功能代码已同步 |
| 2026-09-10 | git add PROJECT_STATUS.md；文档 commit 1ff2164；push origin main | 成功 1463e4e..1ff2164；功能和发布文档已同步，本行保留为本地 push 审计记录 |
| 2026-09-10 | git status/log 检查：HEAD 1ff2164；用户要求拆分工作台并撤下错误上线 | 开始迁移到独立本地目录；不发布工作台，不分配域名 |
| 2026-09-10 | CF API 回滚到 5192e2c3 并核验；源码逐文件验证复制完整后移出出题项目 | comprequiz 恢复纯出题；独立工作台位于 D:/CLAUDEPROJECTS/personal-workbench；历史部署保留 |
| 2026-09-10 | 移除工作台源码并恢复出题单入口；验证两个独立项目 | 出题 150/150，工作台 11/11 与各自构建通过；精确缓存清除因 OAuth 权限不足失败 |
| 2026-09-10 | git diff/status 核对 | 仅本次拆分的 9 个文件变更，无其他源码改动 |
| 2026-09-10 | git add 指定迁出文件并 commit 117b3e3；启动 git push origin main | 修复已本地提交，push 等待网络响应 |
| 2026-09-10 | git push origin main 返回失败 | GitHub:443 连接失败；本地 117b3e3 已保存，线上已独立回滚，远程待网络恢复后同步 |
| 2026-09-10 | 用户指定工作台迁至 D:/ChatGPT/WorkingInterface | 已整体迁移并校验，旧独立目录已移走；阅读项目只更新去向记录，不改代码或部署 |
| 2026-09-18 | 修复 B2「无法生成」：证据地图/Summary/MC 从硬失败改为**优雅降级**（保留重试，失败时返回 best-effort 而非抛错）；B2 枚举字段 type/level/scope 改为大小写/空格不敏感比较 | ✅ 150/150；commit `b1b5d17` |
| 2026-09-18 | 重新 `npm run build`（确认单入口纯出题，无 workbench.html）并部署 CF Pages | ✅ 部署 `1cc38f01`，线上 `index-BiK__d3x.js`（cache-bypass 核验一致） |
| 2026-09-18 | `git push origin main` | ✅ `1ff2164..b1b5d17`，远程已同步 |
| 2026-09-18 | Summary **5 空保证**：新增 `ensureFiveBlanks` 机械补空（原文可查短语，去重、≤maxBlankWords）；commit `3621eef` | ✅ 152/152 |
| 2026-09-18 | 重新构建并部署 CF Pages | ✅ 部署 `219c266f`，线上 `index-ZPhA0dBV.js`（cache-bypass 核验一致） |
| 2026-09-18 | `git push origin main` | ✅ `b1b5d17..3621eef`，远程已同步 |
