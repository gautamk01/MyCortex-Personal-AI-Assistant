# MyCortex — Resume Description

## Project Header

**MyCortex – Autonomous Personal AI Agent**
`TypeScript` · `Node.js` · `SQLite` · `Pinecone` · `OpenAI` · `Telegram` · `WebSocket` · `Railway`

---

## Resume Bullets

- Engineered a self-hosted autonomous AI agent with a streaming agentic loop (tool-calling, multi-turn reasoning, 3-attempt LLM retry, AbortSignal cancellation) and a multi-layer RAG memory context engine spanning 8 subsystems — SQLite knowledge graph, Pinecone vector search, markdown notes, and OCR-extracted media — dynamically injected into every LLM call with automatic token-budget pruning (<6K tokens).

- Built a full-duplex real-time voice pipeline over WebSocket: energy-based VAD state machine (sub-60ms speech detection, pre-speech frame buffering) → faster-whisper STT → streaming LLM inference → sentence-chunked TTS (Kokoro / Sarvam AI); integrated Groq-powered "thinking filler" generation to eliminate conversational dead air during agent processing.

- Designed a proactive accountability engine with cron-scheduled heartbeats (morning / hourly / evening IST), adaptive tone selection driven by drift scoring and inactivity detection, and two-way Todoist sync for daily planning; added a gamification layer (EXP / leveling) rewarding LeetCode solves, work sessions, and task completions to drive consistent engagement.

- Architected production-grade infrastructure: MCP bridge auto-discovering and registering 40+ tools from stdio child-process servers; dynamic Express webhook router with HMAC-authenticated endpoints injecting payloads into the agent loop; Railway cloud deployment with SQLite WAL checkpointing, bidirectional dev↔prod DB sync, and automatic corruption-recovery backup.

---

## Shorter Variant (if 2-bullet limit)

- Engineered a self-hosted agentic AI system (~9K lines TypeScript) with a streaming tool-calling loop, 8-layer RAG memory context (SQLite knowledge graph, Pinecone vectors, OCR media, auto token-pruning), full-duplex WebSocket voice pipeline (energy-based VAD, faster-whisper STT, sentence-chunked TTS), and Groq-powered real-time thinking-filler generation.

- Built production-grade infrastructure on Railway featuring bidirectional SQLite WAL sync, MCP tool auto-discovery, dynamic HMAC-authenticated webhooks, cron-scheduled accountability heartbeats with adaptive LLM tone selection, two-way Todoist sync, and a gamification engine (EXP/leveling) spanning LeetCode, task, and session tracking.

---

## One-Liner (for skills/summary section)

Built a self-hosted multimodal AI agent with streaming agentic loop, 8-layer RAG memory, real-time WebSocket voice pipeline (VAD + STT + TTS), 40+ integrated tools, and production Railway deployment.
