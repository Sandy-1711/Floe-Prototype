# Voice Research Agent

A voice research agent: talk to it, it runs an agentic loop (**think → search → answer**),
and speaks the answer back. Built provider-agnostic — the agent depends only on interfaces,
and concrete providers are injected at a single composition root, so any capability (LLM,
search, STT, TTS) can be swapped or wrapped without touching the agent.

- **LLM** — Google Gemini
- **Search** — Exa
- **Voice (STT + TTS)** — Sarvam

---

## Architecture

```
packages/agent          @repo/agent — the loop and the interfaces. No I/O, no provider knowledge.
  src/ports.ts          LlmProvider · SearchProvider · SttProvider · TtsProvider
  src/agent.ts          ResearchAgent — the think→search→answer loop
  src/types.ts          domain types (GenerateRequest, SearchResults, AgentEvent, …)

providers/              adapters — each implements one or more ports for one backend
  gemini/               @repo/gemini — LlmProvider (Google Gemini)
  exa/                  @repo/exa    — SearchProvider (Exa)
  sarvam/               @repo/sarvam — SttProvider + TtsProvider (Sarvam)

apps/server             Hono API on :4111 — composition root + routes
  src/container.ts      constructs the providers and injects them into the agent
  src/index.ts          routes: /api/stt · /api/agent (NDJSON stream) · /api/tts

apps/web                Next.js UI on :3000 — mic, speaker, live agent trace (presentation only)
```

**Dependency injection.** The agent imports only `ports.ts`. Implementations live in `providers/*`
and are wired together in exactly one place — `apps/server/src/container.ts` — so swapping Gemini
for another model, or wrapping a provider to meter or pay for its calls, is a change to that one file.

---

## Quickstart

**Prerequisites:** Node ≥ 18 and pnpm 9 (`corepack enable`).

```bash
git clone <repo> && cd <repo>
pnpm install
cp .env.example .env          # then fill in the three keys
```

`.env`:

| var | where |
| --- | --- |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `EXA_API_KEY` | [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) |
| `SARVAM_API_KEY` | [dashboard.sarvam.ai](https://dashboard.sarvam.ai) |

Start the server and web UI with one command:

```bash
pnpm dev    # server → http://localhost:4111 · web UI → http://localhost:3000
```

Open **http://localhost:3000**, tap the mic (or type), and the agent answers by voice.

---

## Configuration

`.env` (copy from `.env.example`):

| var | required | notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | **yes** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `EXA_API_KEY` | **yes** | [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) |
| `SARVAM_API_KEY` | **yes** | [dashboard.sarvam.ai](https://dashboard.sarvam.ai) |
| `GEMINI_MODEL` | optional | default `gemini-2.5-flash` |
| `PORT` | optional | server port, default `4111` |
| `WEB_ORIGIN` | optional | CORS origin, default `http://localhost:3000` |

---

## Run & scripts

```bash
pnpm dev                      # server + web concurrently
pnpm build                    # turbo run build across the workspace
pnpm check-types              # tsc --noEmit everywhere
pnpm lint
```

---

## API

| method | route | body | returns |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ ok: true }` |
| POST | `/api/stt` | `multipart` with `file` | `{ text, languageCode, words[], cost? }` |
| POST | `/api/agent` | `{ question }` | NDJSON stream of `AgentEvent` (below) |
| POST | `/api/tts` | `{ text }` | `audio/wav` |

`/api/agent` streams one JSON object per line:

| `type` | payload | meaning |
| --- | --- | --- |
| `thought` | `{ step, text }` | the agent's reasoning for this step |
| `search` | `{ step, query, hits[], cost? }` | a search it ran and what it found |
| `delta` | `{ text }` | a chunk of the final answer as it streams |
| `answer` | `{ text }` | the complete answer |
| `cost` | `{ stage, amount, total }` | per-stage cost + running total, when a provider reports it |
| `done` | `{ totalCost }` | end of stream |
| `error` | `{ message }` | something failed |

The event stream carries optional `cost` fields so a metering provider can report per-call price;
the built-in Gemini/Exa/Sarvam providers don't, so those fields stay empty and the UI meter reads `$0`.

---

## Swapping or adding a provider

The interfaces are the contract. To add a backend, implement the relevant port(s) in a `providers/*`
package and construct it in `container.ts` — nothing else changes:

```ts
export class MyLlmProvider implements LlmProvider {
  readonly model = "my-model";
  async generate(req: GenerateRequest): Promise<GenerateResult> { /* … */ }
  // async *generateStream(req) { … }   // optional: token streaming
}
```
