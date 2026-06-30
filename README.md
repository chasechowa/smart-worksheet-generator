# Smart Worksheet Generator

AI-powered reading comprehension worksheet builder. Paste an article and generate a printable worksheet with summary completion, multiple-choice reading analysis, syntax deconstruction, writing practice, and answer keys.

## Features

- Section-based generation: generate only the worksheet parts you need.
- Editor, print, compact print, interactive, and PDF-oriented views.
- Built-in validation for worksheet structure, answer keys, MCQ metadata, and level-specific quality checks.
- Export to self-contained HTML and PDF.
- AI providers: DeepSeek, Kimi, or any OpenAI-compatible custom endpoint.
- API keys are stored locally.

## Quick Start

```bash
npm install
npm run electron:dev
```

Open AI Configuration, choose DeepSeek, Kimi, or Custom, enter your API key, then generate a worksheet from an article.

## API Providers

| Provider | Key page | Suggested model |
| --- | --- | --- |
| DeepSeek | https://platform.deepseek.com/api_keys | deepseek-v4-pro |
| Kimi | https://platform.moonshot.cn | moonshot-v1-8k |
| Custom | Any OpenAI-compatible endpoint | custom-model |

## Scripts

```bash
npm run dev
npm run build
npm test
npm run electron:dev
```

## Tech Stack

- React 19
- TypeScript
- Vite
- Electron
- Tailwind CSS
