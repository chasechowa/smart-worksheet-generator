# SKILL.md — 双工作流分工与安全边界

> **每个对话开工前必须先读本文件。** 本文件定义谁改什么、共享文件怎么锁、部署权限、完成标准。
> 与个人习惯冲突时，以本文件为准；与用户当次明确指令冲突时，以用户指令为准，但要在
> `PROJECT_STATUS.md` 操作日志里注明越界原因。

## 0. 开工顺序（强制）

1. 读本文件 `SKILL.md`。
2. 读 `PROJECT_STATUS.md`：先看 **§0 分工锁**，再看当前线上版本、Git 状态、最近日志。
3. 读 `AGENTS.md`（部署、Git、模型事实）。
4. 确认自己属于哪条流（见 §1）。不确定就问用户，**不要猜**。
5. 在 `PROJECT_STATUS.md` §0 把自己的行设为 `active` 后再动共享文件。

## 1. 两条流

| 流 | 使命 | 主战场 |
| --- | --- | --- |
| **UI** | 工作台整体界面：外壳、导航、按钮、设置、项目面板、编辑区外观、响应式与主题 | 用户看到并操作的“应用”，不含试卷纸张本身 |
| **LOGIC-PDF** | 出题逻辑、提示词、校验、答案键、试卷纸张渲染、打印/PDF 版式 | 生成内容的正确性与纸面输出 |

### UI 流

**拥有**
- `App.tsx` 的壳层 JSX：header/nav/sidebar、生成按钮与操作区、设置弹窗、项目列表、空状态、移动端布局（按钮背后的生成/校验流程归 LOGIC-PDF）。
- `components/ConfigPanel.tsx`、`ProjectPanel.tsx`、`InputSection.tsx`、`EditorSection.tsx`、`ValidationPanel.tsx`。
- 应用级视觉：颜色、字体、间距、圆角、阴影、动效、响应式断点。
- 如需应用级 CSS，新建 `app.css` 并由 `index.html` 引入；该文件归 UI 流。

**不得**
- 改 `services/**`、`validators/**`、`types.ts`、任何提示词/校验/答案键逻辑。
- 改 `components/TestPreview.tsx` 的试卷纸张版式、`index.css` 的 worksheet/print 规则。
- 改 `PDF_STYLES` / `BASE_STYLES` / `COMPACT_STYLES` / `buildExportHTML` / PDF 导出流程。
- 改 `public/export-tailwind.css` 的导出样式策略（可重新生成，见 §2）。

### LOGIC-PDF 流

**拥有**
- `services/**`（`aiService.ts`、`configService.ts`、`difficultyProfiles.ts`、`validatorService.ts`、`storageService.ts`）。
- `validators/**` 及其测试；`types.ts` 中与出题数据相关的类型。
- 提示词、B2 蓝图、答案键、单题重生、Sentence Insertion 规则。
- `components/TestPreview.tsx`（试卷纸张、答案键、打印/交互/PDF 渲染）。
- `index.css`（worksheet、`.paper`、`@media print`、`.editable-field`、`.insertion-marker`）。
- `App.tsx` 中 PDF/HTML 导出相关：`BASE_STYLES`、`PDF_STYLES`、`COMPACT_STYLES`、`buildExportHTML`、`handleExportPDF`、`handleExportHTML`、`scopeValidationResult` 的展示语义。
- `public/export-tailwind.css`、`tailwind-export.config.js`、`export.css`。

**不得**
- 改工作台外壳布局、导航、主题、响应式、按钮位置/文案/动效。
- 改 `ConfigPanel`、`ProjectPanel` 等壳层组件的视觉与交互（需要新字段时先出接口，由 UI 接入）。

## 2. 共享文件与所有权

| 文件 | 归属 | 规则 |
| --- | --- | --- |
| `App.tsx` | 共享 | UI 只改壳层 JSX；LOGIC-PDF 只改导出/样式/数据 handler。改之前必须持锁，且一次只允许一方。 |
| `index.html` | 共享 | 只做 `<link>`/meta 级改动；改前持锁。 |
| `index.css` | **LOGIC-PDF** | 纸张、打印、编辑框、插入标记样式；UI 不要动。 |
| `app.css`（如新建） | **UI** | 应用外壳专用样式。 |
| `components/TestPreview.tsx` | **LOGIC-PDF** | 试卷纸张与答案键。UI 只可读，不可改版式。 |
| `package.json` / lock / `vite.config.ts` / `tsconfig.json` | 共享 | 改动必须在日志说明原因；避免同时改。 |
| `public/export-tailwind.css` | 生成物 | 谁改动了 Tailwind class，谁 `npm run build:css` 并随提交；不要手改内容。 |
| `dist/` | 构建产物 | 不提交、不手改；只由持部署锁的一方重建。 |
| `PROJECT_STATUS.md` | 共享文档 | 只追加自己的日志；不要覆盖别人的状态段。 |
| `AGENTS.md` / `CLAUDE.md` / `SKILL.md` | 共享文档 | 结构性修改需用户同意。 |

## 3. 工作区、分支与锁

### 3.1 工作区

- **LOGIC-PDF**：当前目录，分支 `main`。
- **UI**：独立 worktree，分支 `ui/overhaul`：

```bash
git fetch origin
git worktree add ../smart-worksheet-generator-ui -b ui/overhaul
cd ../smart-worksheet-generator-ui
npm install
```

- 如果新对话被打开在同一目录：**先停手**，按上面命令建 worktree，或明确等另一方结束再接管。
  不允许两个对话在同一工作树里同时编辑。
- UI 每次 preview 部署前先 `git rebase main`，减少后续合并冲突。

### 3.2 锁表（写在 `PROJECT_STATUS.md` §0）

格式：

| 流 | 状态 | 会话 | 开始时间 | 正在改的文件 |
| --- | --- | --- | --- | --- |
| UI | idle / active | UI 对话 | ISO 时间 | 例：`App.tsx` 壳层、`ConfigPanel.tsx` |
| LOGIC-PDF | idle / active | 当前对话 | ISO 时间 | 例：`aiService.ts`、`TestPreview.tsx` |
| DEPLOY | idle / active | 谁 | ISO 时间 | `main` 或 `ui/overhaul` |

规则：

- 改**共享文件**前必须把自己的行设为 `active` 并列出文件；完成后改回 `idle`。
- 对方 `active` 且列出了你要改的文件：不要动，换任务或等。
- 锁超过 **4 小时** 无更新视为过期；可以接管，但必须写一条日志“接管 <流> 的锁”。
- 每个对话同一时间只能持有一条流的锁；不要替另一条流改代码。

## 4. 部署权限

| 流 | 允许的部署 | 命令 |
| --- | --- | --- |
| UI | **仅 preview** | `npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch ui/overhaul` |
| LOGIC-PDF | **生产** | `npx wrangler pages deploy dist --project-name smart-worksheet-generator --branch main` |

- UI **不得**使用 `--branch main`。需要上线时：UI 合并/交接给 LOGIC-PDF，由后者部署。
- 同一时间只允许一个 `wrangler pages deploy`；部署前确认没有其他 `active` 编辑。
- 部署前必须重新 `npm run build`，确认 `dist/` 是当前源码。
- 部署后记录：deployment id、`assets/index-*.js`、核验 URL、HTTP 状态。
- 部署失败（token 过期、网络）要重试并记日志；不要把“失败”写成“已上线”。

## 5. Git 规则

- UI 提交前缀：`ui: ...`；LOGIC-PDF：`logic: ...` 或 `pdf: ...`；文档：`docs: ...`。
- 只暂存指定文件，禁止 `git add .` / `git add -A`。
- 绝不提交 `.claude/`（凭据）、`.npm-cache/`、`node_modules/`、`dist/`。
- UI 的 `ui/overhaul` 定期 `rebase main`；合并回 `main` 由 LOGIC-PDF 或用户执行。
- 网络失败导致 push 失败时，在状态文件记“待推送”，恢复后补推。

## 6. 跨边界需求

- **行为/数据契约由 LOGIC-PDF 定**：service 签名、`types.ts` 字段、props 形状、错误语义。
  UI 需要新字段/新接口时，先写需求到 `PROJECT_STATUS.md`，由 LOGIC-PDF 实现，UI 再消费。
- **外观/交互由 UI 定**：按钮放哪、文案、间距、动效、响应式；LOGIC-PDF 不顺手改。
- **PDF 版式归 LOGIC-PDF**：页边距、字号、分页、答案键排版、打印样式。
  工作台里“预览容器”的外观归 UI，纸张内部归 LOGIC-PDF。
- 单题重生这类功能：LOGIC-PDF 实现 service + props + 行为；UI 负责按钮位置、样式、加载态外观。
- 出现跨边界改动时，在 `PROJECT_STATUS.md` 写 handoff：
  - `UI needs from LOGIC: ...`
  - `LOGIC needs from UI: ...`

## 7. 完成定义

**UI 流**
- `npx tsc --noEmit`
- `npm run build`
- Playwright/浏览器冒烟：1440px 与 390px 各一张截图，0 console/page error
- preview 部署成功并记录 URL
- 更新 `PROJECT_STATUS.md`（锁、日志）并提交 `ui: ...`

**LOGIC-PDF 流**
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- PDF/打印冒烟：导出 HTML/PDF，检查分页、答案键、题型版式
- 生产部署 + 线上核验（HTML 引用新 `assets/index-*.js`、页面 0 console error）
- 更新 `PROJECT_STATUS.md`（版本、日志）并提交 `logic: ...` / `pdf: ...`

## 8. 明确禁止

- UI 改提示词、校验器、答案键、PDF 纸张样式。
- LOGIC-PDF 改导航、主题、壳层布局、按钮视觉。
- 两个对话同时生产部署；同树并行编辑共享文件。
- 未读锁表就改 `App.tsx` / `index.css` / `TestPreview.tsx`。
- 把凭据、`.claude/` 内容写进任何文档或提交。
- 把未验证的部署/测试写成“已通过”。

## 9. 冲突处理

1. 发现对方正在改同一共享文件：停手，记录，换非共享任务或等锁释放。
2. 需求跨边界：拆成“接口（LOGIC）”+“界面（UI）”两步，先定契约再接。
3. 拿不准归属：**问用户**，不要用“顺手改一下”解决。
4. 已经越界：立即停止、在日志说明、把改动交给归属方复核。

## 10. 新对话开场模板

> 我是 **UI 流**（或 **LOGIC-PDF 流**）。已读 `SKILL.md`、`PROJECT_STATUS.md` §0 与 `AGENTS.md`。
> 当前锁状态：UI=…，LOGIC-PDF=…，DEPLOY=…。
> 我计划改：…（仅限本流拥有的文件）。先占锁，再开工。

## 11. 快速判定

- 颜色、间距、字体、导航、侧栏、弹窗、移动端、按钮位置/文案 → **UI**。
- 提示词、题型、答案、校验、题目重生、Sentence Insertion 规则 → **LOGIC-PDF**。
- 试卷纸张、字号、分页、页边距、答案键排版、打印/PDF → **LOGIC-PDF**。
- 工作台里“预览框”的边框/背景/位置 → **UI**；框里的纸 → **LOGIC-PDF**。
