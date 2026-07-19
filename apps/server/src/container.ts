import { ResearchAgent } from "@repo/agent/core";
import type { SttProvider, TtsProvider } from "@repo/agent/core";
import {
  ExaSearchProvider,
  GeminiLlmProvider,
  SarvamSttProvider,
  SarvamTtsProvider,
} from "@repo/agent/providers";
import { env } from "./env.ts";

// Composition root: providers are constructed once here and injected downstream.
// Swap any implementation (e.g. wrap a provider to pay through Floe) in this file only.
export interface Container {
  agent: ResearchAgent;
  stt: SttProvider;
  tts: TtsProvider;
}

export function createContainer(): Container {
  const llm = new GeminiLlmProvider(env.geminiApiKey, env.geminiModel);
  const search = new ExaSearchProvider(env.exaApiKey);
  const stt = new SarvamSttProvider(env.sarvamApiKey, { languageCode: "en-IN" });
  const tts = new SarvamTtsProvider(env.sarvamApiKey, {
    targetLanguageCode: "en-IN",
  });

  const agent = new ResearchAgent({ llm, search });
  return { agent, stt, tts };
}
