// Floe-routed providers go here.
//
// Implement the ports from "@repo/agent" so the composition root can swap these in
// without touching core or the agent:
//   - LlmProvider     -> POST {FLOE_BASE}/chat/completions   (model "google/gemini-2.5-flash")
//   - SearchProvider  -> POST {FLOE_BASE}/proxy/fetch         (url https://api.exa.ai/search)
//   - SttProvider     -> POST {FLOE_BASE}/proxy/fetch         (url .../v1/stt/sarvam)
//   - TtsProvider     -> POST {FLOE_BASE}/proxy/fetch         (url .../v1/tts/sarvam)
//
// Auth is the funded Floe key only: `Authorization: Bearer $FLOE_KEY`.
export {};
