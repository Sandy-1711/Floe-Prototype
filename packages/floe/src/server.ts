// Server-only surface: the client (which lazily loads the Node-only floe-agent SDK)
// and the agent loop that drives it. Import this from route handlers / node scripts,
// never from browser code.
export { FloeClient, type FloeClientOptions } from "./client.ts";
export { geminiGenerate } from "./adapters/gemini.ts";
export {
  runResearchAgent,
  type AgentEvent,
  type AgentOptions,
  type AgentResult,
} from "./agent.ts";
