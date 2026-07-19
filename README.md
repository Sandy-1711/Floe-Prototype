# Floe Voice Agent

A voice research agent: talk to it, it runs an agentic loop (**think → search → answer**),
and speaks the answer back. Built provider-agnostic — the core depends only on interfaces,
and providers are injected at a single composition root, so any capability (LLM, search,
STT, TTS) can be swapped or wrapped without touching the agent.

- **LLM** — Google Gemini
- **Search** — Exa
- **Voice (STT + TTS)** — Sarvam

## Architecture

```
packages/agent            @repo/agent — no framework, no I/O beyond the providers
  src/core                interfaces + the agent, zero provider knowledge
    ports.ts              LlmProvider · SearchProvider · SttProvider · TtsProvider
    agent.ts              ResearchAgent — the think→search→answer loop
    types.ts              domain types
  src/providers           implementations of the ports
    gemini.ts · exa.ts · sarvam.ts

apps/server               Hono API on :4111
  src/container.ts        composition root — constructs + injects the providers
  src/index.ts            routes: /api/stt · /api/agent (stream) · /api/tts

apps/web                  Next.js chat UI on :3000 — mic, speaker, live agent trace
```

**Dependency injection.** `core` imports only `ports.ts`. Implementations live in
`providers`. They are wired together in exactly one place — `apps/server/src/container.ts`
— so swapping Gemini for another model, or wrapping a provider to meter/pay for its calls,
is a change to that one file and nothing else.

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in the three keys
```

`.env`:

| var              | where                              |
| ---------------- | ---------------------------------- |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `EXA_API_KEY`    | https://dashboard.exa.ai/api-keys  |
| `SARVAM_API_KEY` | https://dashboard.sarvam.ai        |

## Run

Two processes:

```bash
pnpm --filter server dev   # API on http://localhost:4111
pnpm --filter web dev      # UI  on http://localhost:3000
```

Open http://localhost:3000, tap the mic (or type), and the agent answers by voice.

## API

| method | route        | body                    | returns                                                |
| ------ | ------------ | ----------------------- | ------------------------------------------------------ |
| POST   | `/api/stt`   | `multipart` with `file` | `{ text, languageCode, words[] }`                      |
| POST   | `/api/agent` | `{ question }`          | NDJSON stream of `{type: thought \| search \| answer}` |
| POST   | `/api/tts`   | `{ text }`              | `audio/wav`                                            |
