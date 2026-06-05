# Smart Worksheet Generator 📝 智能练习册生成器

AI 驱动的阅读理解练习册生成工具。粘贴一篇文章 → 自动生成包含 4 大题型的可打印练习册，附带完整答案。

**离线运行** — 这是一个桌面软件，不是网页。你的 API Key 存在本地电脑上，不会上传到别处。

> AI-powered reading comprehension worksheet builder. Paste an article → get a printable worksheet with 4 exercise sections and answer key. Runs as a desktop app — your API key stays on your machine.

## 功能 Features

- **4 大题型的练习册：** 摘要填空 / 阅读理解选择题 / 长难句拆解 / 写作训练
- **3 种预览模式：** 编辑模式、打印模式（标准/紧凑）、交互答题模式
- **自动校验：** 内置校验器检查各题型答案一致性
- **PDF 导出：** 一键导出 A4 排版 PDF，可直接打印
- **HTML 导出：** 自包含 HTML 文件，不依赖网络，离线也能打开
- **多 AI 提供商：** 支持 Gemini · DeepSeek · Kimi · 自定义 OpenAI 兼容接口
- **AI 自动优化：** 生成后自动检测并修正错误，无需手动调整

## 快速开始 Quick Start

### 方式一：下载安装包（推荐）Download Installer

1. 打开 [Releases 页面](https://github.com/chasechowa/smart-worksheet-generator/releases)
2. 下载 `Smart Worksheet Generator Setup x.x.x.exe`
3. 双击安装
4. 打开软件，点击右上角 ⚙️ **AI 设置**，粘贴你的 API Key
5. 粘贴文章 → 点击 **生成**，完成！

### 方式二：从源码运行 Build from Source

需要电脑已安装 Node.js。

```bash
git clone https://github.com/chasechowa/smart-worksheet-generator.git
cd smart-worksheet-generator
npm install
npm run electron:dev
```

## API Key 获取方式 API Key Setup

| AI 提供商 | Key 获取地址 | 推荐模型 |
|----------|-------------|-------|
| **Gemini**（默认） | [Google AI Studio](https://aistudio.google.com/apikey) | gemini-3-flash-preview |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | deepseek-chat |
| Kimi（月之暗面） | [platform.moonshot.cn](https://platform.moonshot.cn) | moonshot-v1-8k |
| 自定义 Custom | 任何 OpenAI 兼容接口 | — |

Gemini 的 API 是**免费**的，推荐优先使用。

> Key 只存在你自己的电脑上，仅在与 AI 提供商通信时使用，不会经过第三方服务器。

## 技术栈 Tech Stack

- **前端：** React 19 + TypeScript + Vite
- **桌面框架：** Electron 35
- **样式：** Tailwind CSS（静态构建，不依赖 CDN）
- **AI：** 多提供商代理，通过 Electron IPC 转发

## 开源协议 License

MIT — 可自由使用、修改、分发。
