# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Dev mode: syncs prod DB, starts bot with tsx watch
npm run build      # TypeScript compile → dist/
npm start          # Run compiled production build
```

No test suite is configured. TypeScript strict mode is enabled — run `npx tsc --noEmit` to type-check.

**Python sidecars** (start separately if using voice locally):
```bash
cd tts-server && pip install -r requirements.txt && python server.py   # Kokoro TTS on :8880
cd stt-server && pip install -r requirements.txt && python server.py   # Faster-Whisper STT on :8890
```

## Architecture Overview

**MyCortex** is a Telegram-based autonomous AI agent. The main loop:

1. `src/index.ts` — wires all subsystems together at startup
2. `src/bot.ts` — grammY Telegram bot (long-polling); routes messages to `runAgent()`
3. `src/agent.ts` — agentic loop: builds system prompt → calls LLM → executes tools → iterates (max 10 rounds)
4. `src/prompt.ts` — assembles system prompt from `soul.md`, loaded skills, and full memory context
5. `src/llm.ts` — OpenAI-compatible client; supports primary + backup model fallback

### Memory System (`src/memory/`)
Five independent subsystems, all unified via `memory/index.ts → getFullMemoryContext()`:
- **SQLite** (`sqlite.ts`) — facts, entities, relations, gamification, coaching, daily plans — all in `data/cortex.db`
- **Knowledge Graph** (`knowledge-graph.ts`) — entity-relationship traversal on top of SQLite
- **Markdown Notes** (`markdown.ts`) — `.md` files in `data/notes/` with YAML frontmatter
- **Multimodal** (`multimodal.ts`) — media file metadata stored in SQLite
- **Semantic** (`semantic-memory.ts`) — Pinecone + OpenAI embeddings (optional; only active if `PINECONE_API_KEY` set)

Memory context is injected into every LLM call. Context pruning triggers at `MAX_CONTEXT_TOKENS` via `context-pruner.ts`.

### Tools (`src/tools/`)
All tools self-register on import in `tools/index.ts`. Exposed as OpenAI function-call schemas. Key tools:
- `shell.ts` — allowlisted shell commands
- `file-ops.ts` — file R/W with path ACL
- `browseros.ts` — BrowserOS MCP integration (replaces the disabled Playwright `browser.ts`)
- `desktop.ts` — GUI automation (xdotool/xdg-open)
- `terminal.ts` — persistent PTY sessions

### Voice Pipeline (`src/voice/`)
Voice mode flow: WebSocket audio → `local-stt.ts` (Whisper) → agent loop with `groq-filler.ts` thinking fillers → `tts.ts` (Kokoro) → audio back over WebSocket. Voice server only starts when `NODE_ENV !== 'production'`.

### Webhooks & Sync (`src/webhooks/`)
Express server on `WEBHOOK_PORT` (default 3456). Endpoints:
- `/api/sync/*` — DB download/upload + pause/resume for dev-sync script
- `/api/dashboard/*` — Mission Control web UI API

### Dev Sync (`scripts/dev-sync.ts`)
The `npm run dev` wrapper: pauses the Railway production bot → downloads its SQLite DB → starts local bot with `tsx watch`. On Ctrl+C: checkpoints WAL → uploads DB back → resumes production. If the downloaded DB is corrupt, it is automatically deleted and the bot starts with a fresh DB.

### Scheduler & Heartbeat
- `src/scheduler/index.ts` — cron tasks that fire into the agent loop
- `src/heartbeat.ts` — daily accountability service: LeetCode check (10 AM), evening summary (10 PM), configurable hourly check-ins
- `src/coach.ts` + `src/daily-plan.ts` — coaching profile and daily plan CRUD with Todoist sync

### Skills (`src/skills/`, `./skills/`)
Markdown files with frontmatter (`name`, `description`, `triggers`). All `.md` files in `./skills/` are loaded at startup and injected verbatim into the system prompt.

### MCP Bridge (`src/mcp/`)
Reads `mcp-servers.json` at startup, launches each server as a subprocess, and registers their tools prefixed `mcp_<server>_<tool>`.

## Key Config

All config is in `src/config.ts`, sourced from env vars. Copy `.env.example` to `.env`. Minimum required vars:
- `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS`
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`
- `SYNC_SECRET`, `PROD_WEBHOOK_URL` (only for `npm run dev` sync)

## Deployment

Railway: `Procfile` runs `npx tsx src/index.ts`. DB and notes persist via `RAILWAY_VOLUME_MOUNT_PATH`. The app auto-detects Railway and disables the voice WebSocket server.
