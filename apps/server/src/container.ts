import { ResearchAgent } from "@repo/agent";
import type { SttProvider, TtsProvider } from "@repo/agent";
import { GeminiLlmProvider } from "@repo/gemini";
import { ExaSearchProvider } from "@repo/exa";
import { SarvamSttProvider, SarvamTtsProvider } from "@repo/sarvam";
import { env } from "./env.ts";
import { FloeLLMProvider, FloeSTTProvider, FloeTTSProvider } from "@repo/floe";

// Composition root: providers are constructed once here and injected downstream.
// Swap any implementation (e.g. the Floe-routed providers from @repo/floe) in this
// file only — core and the agent never change.
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
  const floeLLM = new FloeLLMProvider(env.floeApiKey, env.geminiModel);
  const floeStt = new FloeSTTProvider(env.floeApiKey, {
    languageCode: "en-IN",
    model: "saaras:v3"
  });
  const floeTts = new FloeTTSProvider(env.floeApiKey, {
    targetLanguageCode: "en-IN",
    model: "bulbul:v3",
    speaker: "shubh",
    sampleRate: undefined, // optional, can be set to a number if needed
  });

  const agent = new ResearchAgent({ llm: floeLLM, search });
  return { agent, stt: floeStt, tts: floeTts };
}
