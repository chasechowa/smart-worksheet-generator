# 阅读出题系统架构重构设计

## Overview

将现有的 Smart Worksheet Generator（Electron + React 阅读理解 worksheet 生成器）按 VocabForge AI 的架构模式进行重构，保留核心阅读出题逻辑，增强 API 配置管理、题目质量校验、本地持久化三大能力。

## Goals

1. **多 Provider API 管理**：按 provider 独立存储配置，支持 custom OpenAI-compatible 接口，带连接测试
2. **题目标准校验**：内置规则引擎和自动修正，防止 AI 输出偏离规范
3. **难度分级控制**：保留现有 A2/B1/B2/C1 体系，在 prompt 和校验层细化区分
4. **本地项目存档**：基于 Electron 文件系统 API，Project 粒度持久化（文章 + 多套测试卷）

## Architecture

保留现有技术栈：**Electron 35 + Vite 6 + React 19 + TypeScript + Tailwind CSS**。

在 Renderer 进程新增四个核心服务层：

| 服务 | 职责 |
|------|------|
| `configService` | 多 Provider API 配置管理（读/写/切换/验证） |
| `aiService` | 保留现有生成逻辑，配置来源改为 `configService` |
| `validatorService` | 对 AI 返回的 `WorksheetData` 执行结构和规则校验 |
| `storageService` | 通过 IPC 调用 Main 进程 `fs` API，管理本地项目文件 |

Electron Main 进程新增 IPC 通道：`fs:read`, `fs:write`, `fs:list`, `fs:delete`，在 `userData/documents/` 目录下操作 JSON 项目文件。

### 数据流

1. 用户粘贴文章 → 选择难度 → 点击生成
2. `aiService` 从 `configService` 取当前 provider 配置 → 拼接 prompt → 通过 IPC proxy 调用 AI
3. AI 返回 JSON → `validatorService` 执行结构 + 规则校验
4. 校验结果：
   - **通过**：写入 `_meta.validated = true`，渲染编辑器，自动保存到当前 Project
   - **未通过**：弹窗列出具体问题，提供"重新生成"或"强制使用"
5. 用户编辑/导出时，`storageService` 自动写回本地 JSON

## Data Model

### AIConfig（增强）

```ts
type AIProvider = 'gemini' | 'deepseek' | 'kimi' | 'custom';

interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;      // custom provider 必填
  enabled: boolean;
}
```

### ProviderConfigs（localStorage 存储结构）

```ts
interface ProviderConfigs {
  activeProvider: AIProvider;
  providers: Record<AIProvider, AIConfig>;
}
```

存储键名：`vocabforge_ai_keys`。每个 provider 独立保存，切换时不丢失已填的 key。

### Project（本地存档单元）

```ts
interface Project {
  id: string;            // uuid
  title: string;
  articleText: string;   // 完整原始文章
  difficulty: Difficulty;
  createdAt: number;
  updatedAt: number;
  worksheets: WorksheetData[];
}
```

### WorksheetData（保留现有结构，增加元数据）

```ts
interface WorksheetData {
  title: string;
  articleSnippet: string;
  summary: { paragraph: string; blanks: string[] };
  multipleChoice: MCQuestion[];
  syntaxDeconstruction: SyntaxDeconstructionItem[];
  writingWorkshop: WritingWorkshop;
  keys: Keys;
  _meta?: {
    generatedAt: number;
    provider: AIProvider;
    model: string;
    validated: boolean;
    validationIssues: string[];
  };
}
```

现有子类型（`MCQuestion`, `SyntaxDeconstructionItem`, `ExpansionItem`, `Keys` 等）全部保留，不做破坏性修改。

## API Configuration System

### configService API

```ts
getActiveProvider(): AIProvider
getActiveConfig(): AIConfig
getAllConfigs(): Record<AIProvider, AIConfig>
setProviderConfig(provider: AIProvider, config: AIConfig): void
setActiveProvider(provider: AIProvider): void
validateConfig(config: AIConfig): { valid: boolean; error?: string }
testConnection(config: AIConfig): Promise<{ success: boolean; error?: string }>
```

### UI 配置面板

替换现有 sidebar 中的简单三字段表单，改为：

- Provider 下拉切换（Gemini / DeepSeek / Kimi / Custom）
- 切换后动态加载该 provider 的已存配置
- 模型下拉（预置各 provider 的默认模型列表）
- API Key 输入框
- Custom provider 额外显示 Base URL 输入框
- **Test Connection** 按钮：发轻量请求验证 key（Gemini 用 list models，OpenAI-compatible 用简单 completion）
- Save Config 后才写入 localStorage

### Main 进程 Proxy 增强

保留现有 `api-call` IPC，增加：
- Custom provider 的 `baseUrl` 合法性校验（必须以 `http(s)://` 开头）
- 开发模式下可选请求日志

所有 OpenAI-compatible provider（DeepSeek / Kimi / Custom）共用同一套 `callOpenAICompatible` 调用逻辑，`baseUrl` 由 `PROVIDER_BASE_URLS` 或用户自定义提供。

## Question Validation System

### 核心设计

```ts
interface ValidationIssue {
  type: 'structure' | 'rule' | 'reference';
  section: 'summary' | 'mc' | 'syntax' | 'writing' | 'keys' | 'global';
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
}

interface ValidationResult {
  valid: boolean;          // error 数为 0 时 true
  issues: ValidationIssue[];
  autoFixed: boolean;
  data: WorksheetData;     // 经自动修正后的数据
}
```

入口：
```ts
validateWorksheet(data: WorksheetData, articleText: string): ValidationResult
```

### 校验规则（按题型）

**Global**
- `title` 非空
- `articleSnippet` 非空
- `keys` 存在且字段完整

**Summary Completion**
- `[BLANK]` 出现次数 === `blanks` 长度 === `keys.summary` 长度
- 每个答案在 `articleText` 中可找到（允许大小写/标点差异）
- 每个答案词数 ≤ 3

**Multiple Choice**
- 总题数 === 10
- 每题恰好 4 个选项
- 题型分布：`Finding Evidence` 恰好 2 道；`Vocabulary in Context` ≤ 1 道
- 选项不能带 `A.`/`B.`/`1.` 等前缀 → **自动修正**
- `answer` 必须是 `options` 之一 → **自动修正（模糊匹配）**
- `answer` 值应为字母 A/B/C/D → **自动修正（选项文本转字母）**
- 答案均匀分布 A/B/C/D（各 2-3 个）→ **warning**
- 选项长度差异不超过 50% → **warning**
- `explanation` 非空

**Syntax Deconstruction**
- 恰好 2 题
- `original` 在 `articleText` 中相似度 > 80%
- `answer` 非空

**Writing Workshop**
- Expansion：恰好 4 题，`conjunctions` 每题至少 1 个
- Keywords：恰好 5 个，每词在 `articleText` 中出现
- Q&A：恰好 4 题
- Critical Thinking：非空字符串

**Keys**
- 各 section key 数量与对应题目数量一致

### 自动修正策略

| 问题 | 修正方式 |
|------|----------|
| 选项带前缀 | 正则去除 `A.`/`B)`/`1.` 等 |
| MC answer 是选项文本 | 匹配索引转 A/B/C/D |
| summary blanks/keys 长度不一致但 paragraph 匹配 | 以 paragraph 为准重新对齐 |

无法自动修正的（题数不对、答案分布不均等）作为 error/warning 展示。

### 标准范例

内置两套 hand-crafted 范例 JSON 于 `src/data/standard-examples/`：
- `example-b2-sat.json`
- `example-c1-ielts.json`

用途：结构参照、规则阈值校准（如选项长度差异 50% 为经验值）、校验器单元测试。

### UI 反馈

- 全部通过：状态栏 ✅ 已校验
- 有 warning：状态栏 ⚠️ n warnings，可展开查看
- 有 error：拦截弹窗，列出 error + suggestion，提供"重新生成"/"强制使用"

## Local Persistence System

### storageService API

```ts
getProjects(): Promise<ProjectMeta[]>
getProject(id: string): Promise<Project>
saveProject(project: Project): Promise<void>
deleteProject(id: string): Promise<void>
exportProject(project: Project): string        // JSON 字符串
importProject(json: string): Project
```

### Electron Main 进程文件操作

存储目录：`app.getPath('userData')/documents/`

- `fs:list`：读取目录下所有 `.json`，解析为 `ProjectMeta` 列表（按 `updatedAt` 降序）
- `fs:read(id)`：读取 `{id}.json`
- `fs:write(project)`：序列化写入 `{project.id}.json`
- `fs:delete(id)`：删除 `{id}.json`

### 项目文件格式

每项目一个 JSON 文件：`{uuid}.json`

包含完整 `Project` 结构（含 `articleText` 和 `worksheets` 数组）。

### 自动保存策略

- **首次生成**：校验通过后自动创建 Project 并保存
- **编辑时**：editor 模式下 debounce 500ms 自动 `saveProject`
- **关闭前**：`beforeunload` flush 未保存更改
- **手动保存**：sidebar 提供 💾 Save 按钮

### UI 存档管理

Sidebar 新增 Projects 区域：
- New Project 按钮
- 项目列表（标题 + 难度 + worksheet 数 + 编辑/删除按钮）
- Export All 按钮（导出所有项目 JSON 的 zip）
- 支持从文件导入项目（拖放或选择文件）

## File Structure

```
├── electron/
│   ├── main.ts              # BrowserWindow + IPC (api-call + fs:*)
│   └── preload.ts           # contextBridge expose (api-call + fs:*)
├── src/
│   ├── main.tsx             # React 入口
│   ├── App.tsx              # 全局状态 + 布局骨架（大幅瘦身）
│   ├── types.ts             # 全部类型定义（追加新类型）
│   ├── index.css            # 全局样式 + 动画
│   ├── components/
│   │   ├── InputSection.tsx         # 文章输入、难度、生成按钮
│   │   ├── TestPreview.tsx          # 测试卷渲染/编辑（原 WorksheetPaper）
│   │   ├── SectionTogglePanel.tsx   # 题型开关与排序
│   │   ├── ConfigPanel.tsx          # AI Provider 配置面板
│   │   ├── ProjectPanel.tsx         # 项目列表与管理
│   │   ├── ValidationPanel.tsx      # 校验结果展示
│   │   └── EditorSection.tsx        # 通用折叠面板壳子
│   ├── services/
│   │   ├── aiService.ts             #  worksheet 生成（保留核心逻辑）
│   │   ├── configService.ts         #  Provider 配置管理
│   │   ├── validatorService.ts      #  校验入口与编排
│   │   ├── storageService.ts        #  本地文件管理（Renderer 侧）
│   │   └── geminiService.ts         #  Gemini 专用流式接口（预留）
│   ├── validators/
│   │   ├── index.ts                 # 校验器编排
│   │   ├── summaryValidator.ts
│   │   ├── mcValidator.ts
│   │   ├── syntaxValidator.ts
│   │   ├── writingValidator.ts
│   │   └── keysValidator.ts
│   ├── data/
│   │   └── standard-examples/
│   │       ├── example-b2-sat.json
│   │       └── example-c1-ielts.json
│   └── utils/
│       └── pdfExport.ts             # PDF 导出预留
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Migration Plan

| 现有文件 | 处理方式 |
|----------|----------|
| `electron/main.js` | 改为 `.ts`，新增 `fs:*` IPC handlers |
| `electron/preload.js` | 改为 `.ts`，暴露 `fs:*` API |
| `App.tsx` | 瘦身：保留全局状态与布局，UI 逻辑拆至 components |
| `services/aiService.ts` | 保留生成逻辑，`getStoredConfig` 等移至 `configService` |
| `types.ts` | 追加 `Project`, `ProviderConfigs`, `ValidationResult` 等 |
| `components/EditorSection.tsx` | 保留 |

## Key Decisions

1. **localStorage 只存配置，项目数据走文件系统**：避免 localStorage 容量限制，存档更可靠
2. **Project 粒度 = 文章 + 多套测试卷**：支持同一篇文章生成多个版本或修改后另存
3. **校验器按题型拆分文件**：规则独立，便于单测和维护
4. **保留现有 WorksheetData 结构**：不破坏现有渲染和导出逻辑，降低重构风险
5. **HTML 导出保留，PDF 预留**：当前 HTML 导出已满足打印需求，jsPDF 可作为后续迭代
