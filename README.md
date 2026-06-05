# Smart Worksheet Generator 📝

AI-powered reading comprehension worksheet builder. Paste an article → get a printable worksheet with 4 exercise sections, complete with an answer key.

**Works offline** — runs as a desktop app, not a website. Your API key stays on your machine.

## Features

- **4 Exercise Sections:** Summary Completion, Multiple Choice, Syntax Deconstruction, Writing Workshop
- **3 View Modes:** Editor, Print (standard / compact), Interactive
- **Auto-Validation:** Built-in validators check answer consistency across sections
- **PDF Export:** One-click A4 PDF with proper print layout
- **Self-Contained HTML Export:** Offline-capable, no CDN dependency
- **Multi-Provider AI:** Gemini · DeepSeek · Kimi · Custom OpenAI-compatible
- **Progressive Refinement:** Auto-detects and fixes errors before you see the worksheet

## Quick Start

### Option 1: Download Installer (Recommended)

1. Go to [Releases](https://github.com/chasechowa/smart-worksheet-generator/releases)
2. Download `Smart-Worksheet-Generator-Setup-x.x.x.exe`
3. Run the installer
4. Launch the app, open **AI Configuration** ⚙️, paste your API key
5. Paste an article and click **Generate**

### Option 2: Build from Source

```bash
git clone https://github.com/chasechowa/smart-worksheet-generator.git
cd smart-worksheet-generator
npm install
npm run electron:dev
```

## API Key Setup

| Provider | Get Key From | Model |
|----------|-------------|-------|
| **Gemini** (default) | [Google AI Studio](https://aistudio.google.com/apikey) | gemini-3-flash-preview |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | deepseek-chat |
| Kimi | [platform.moonshot.cn](https://platform.moonshot.cn) | moonshot-v1-8k |
| Custom | Any OpenAI-compatible endpoint | — |

Keys are stored locally on your computer, never sent anywhere except to your chosen AI provider.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Desktop Shell:** Electron 35
- **Styling:** Tailwind CSS (static build, no CDN)
- **AI Integration:** Multi-provider proxy via Electron IPC

## License

MIT — use, modify, and share freely.
