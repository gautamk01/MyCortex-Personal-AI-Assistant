# 🧠 MyCortex

**Autonomous Personal AI Agent via Telegram**

MyCortex is a self-hosted, agentic AI assistant that runs on your local machine and communicates through Telegram. It features an autonomous tool-calling loop, persistent memory with a knowledge graph, browser automation, task scheduling, voice I/O, and extensible skills — all controlled from a simple chat interface.

---

## ✨ Features

### 🤖 Agentic Tool Loop

- Autonomous multi-step reasoning — the agent plans, uses tools, and iterates until the task is done
- Supports any OpenAI-compatible LLM provider (Ollama, OpenRouter, etc.)
- Configurable iteration limits with retry logic for transient API errors

### 🧠 Persistent Memory System

- **SQLite Memory** — store facts, preferences, and context that persists across sessions
- **Automated Backups** — built-in database corruption backups and safety checks
- **Knowledge Graph** — interconnected entities and relationships with graph traversal queries
- **Markdown Notes** — human-readable `.md` files with YAML frontmatter, git-friendly
- **Multimodal Memory** — metadata extraction and search for images, audio, video, and documents
- **Self-Evolving Memory** — access tracking, importance decay, duplicate merging, and maintenance
- **Context Pruning** — auto-summarizes older messages when approaching token limits (`/compact`)

### 🎛️ Mission Control Dashboard

- Visual drag-and-drop workflow builder using React and `@xyflow/react`
- Backend execution engine for composing and executing automated agent tasks
- Real-time environment monitoring and modular UI components

### 🌐 Web & Browser Automation

- Headless (or headed) browser via Playwright
- Deep integration with BrowserOS for fully autonomous web task execution
- Navigate, click, type, screenshot, and extract content from web pages
- Web search tool for real-time information retrieval

### 💻 System & Shell Access

- Allowlisted shell command execution with configurable timeouts
- Persistent terminal sessions that maintain state across commands
- File operations — read, write, search, delete with path-based access control

### 🖥️ Desktop GUI Control

- Open terminal windows, file managers, and applications
- Type commands inTypes of Supervised Problemsto visible terminals
- Send keyboard shortcuts (Ctrl+C, Tab, etc.)
- Open files with default applications and URLs in the browser

### ⏰ Task Scheduling

- Cron-based recurring task scheduler
- Pause, resume, and delete scheduled tasks
- Tasks fire into the agent loop automatically

### 📈 Personal Tracking Tools

- Dedicated tools for structured logging (e.g., LeetCode revision tracking)
- Company and job application tracking integrated into the AI workflow

### 🪝 Webhooks

- Create HTTP endpoints that route incoming payloads to the agent
- Optional secret-based authentication
- Built-in Express server

### 🔊 Voice I/O

- Hands-free voice detection with wake word support ("Hey Leo")
- Real-time streaming TTS and dynamic Groq-generated thoughts for continuous agent progress reporting
- Voice message broadcasting for scheduled system heartbeats and alerts
- Local Text-to-Speech via Kokoro TTS (Python sidecar)
- Switch between text and voice reply modes
- Automatic markdown stripping for clean speech output

### 🔌 MCP Bridge

- Connect external tools via the Model Context Protocol (MCP)
- Auto-discovers and registers tools from configured MCP servers
- JSON-based server configuration

### 📚 Skills System

- Hot-loadable skills from `.md` files
- Skills are injected into the system prompt at runtime
- Add new capabilities without code changes

### 🤖 Codex CLI Integration

- Send prompts to the locally installed OpenAI Codex CLI
- Deep coding assistance directly from Telegram

---

## 🛠️ Tech Stack

| Layer                  | Technology                                            |
| ---------------------- | ----------------------------------------------------- |
| **Runtime**            | Node.js (≥18) + TypeScript (ES2022, strict mode)      |
| **Telegram Bot**       | grammY                                                |
| **LLM Client**         | OpenAI SDK (compatible with Ollama, OpenRouter, etc.) |
| **Database**           | SQLite via better-sqlite3                             |
| **Browser Automation** | Playwright                                            |
| **HTTP Server**        | Express                                               |
| **Task Scheduling**    | node-cron                                             |
| **Tool Protocol**      | Model Context Protocol (MCP) SDK                      |
| **TTS Engine**         | Kokoro-82M (Python/FastAPI sidecar)                   |
| **Dev Tooling**        | tsx (dev), tsc (build)                                |

---

## 📁 Project Structure

```
cortex/
├── src/
│   ├── index.ts            # Entry point — wires all subsystems
│   ├── agent.ts            # Agentic tool loop (LLM → tools → LLM → …)
│   ├── bot.ts              # Telegram bot commands & message handling
│   ├── config.ts           # Environment-based configuration
│   ├── llm.ts              # LLM client (OpenAI-compatible)
│   ├── prompt.ts           # System prompt with tool documentation
│   ├── tts.ts              # Kokoro TTS client
│   ├── memory/
│   │   ├── index.ts        # Memory system init & unified context
│   │   ├── sqlite.ts       # SQLite DB, schema, facts CRUD
│   │   ├── knowledge-graph.ts  # Entity-relationship graph
│   │   ├── context-pruner.ts   # Token-aware auto-summarization
│   │   ├── multimodal.ts   # Media metadata storage & search
│   │   ├── evolution.ts    # Access tracking, decay, merge
│   │   └── markdown.ts     # .md note files with frontmatter
│   ├── tools/
│   │   ├── index.ts        # Tool registry
│   │   ├── shell.ts        # Shell command execution
│   │   ├── file-ops.ts     # File read/write/search/delete
│   │   ├── browser.ts      # Playwright browser automation
│   │   ├── web-search.ts   # Web search
│   │   ├── terminal.ts     # Persistent terminal sessions
│   │   ├── desktop.ts      # GUI desktop control
│   │   ├── codex.ts        # Codex CLI integration
│   │   └── get-current-time.ts
│   ├── scheduler/          # Cron-based task scheduling
│   ├── webhooks/           # HTTP webhook endpoints
│   ├── skills/             # Hot-loadable .md skill files
│   └── mcp/               # MCP server bridge
├── mission-control/        # Next.js visual dashboard and workflow builder
├── BrowserOS/              # Agentic browser interaction environment
├── voice-agent/            # Advanced voice detection and streaming service
├── tts-server/             # Kokoro TTS Python sidecar
├── stt-server/             # Local Speech-to-Text server
├── skills/                 # Skill definition files
├── data/                   # SQLite DB + markdown notes (gitignored)
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
- An LLM provider (local [Ollama](https://ollama.ai) or [OpenRouter](https://openrouter.ai))

### Installation

```bash
git clone https://github.com/yourusername/cortex.git
cd cortex
npm install
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_USER_IDS=your_telegram_user_id
LLM_BASE_URL=http://localhost:11434/v1    # Ollama
LLM_MODEL=qwen3:8b
```

### Run

```bash
# Development (hot-reload)
npm run dev

# Production
npm run build
npm start
```

---

## 💬 Bot Commands

| Command     | Description                                  |
| ----------- | -------------------------------------------- |
| `/start`    | Show welcome message and available commands  |
| `/text`     | Switch to text-only replies (default)        |
| `/voice`    | Switch to voice-only replies                 |
| `/gui`      | Use visible desktop actions                  |
| `/terminal` | Use background shell (default)               |
| `/compact`  | Compress conversation history to save tokens |
| `/codex`    | Send a prompt to Codex CLI                   |

---

## 🔊 Voice Setup (Optional)

```bash
cd tts-server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python server.py
```

---
