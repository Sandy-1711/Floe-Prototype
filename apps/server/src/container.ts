import { ResearchAgent } from "@repo/agent";
import type { SttProvider, TtsProvider } from "@repo/agent";
import { GeminiLlmProvider } from "@repo/gemini";
import { ExaSearchProvider } from "@repo/exa";
import { SarvamSttProvider, SarvamTtsProvider } from "@repo/sarvam";
import { env } from "./env.ts";
import { FloeLLMProvider, FloeSearchProvider, FloeSTTProvider, FloeTTSProvider } from "@repo/floe";

export interface Container {
  agent: ResearchAgent;
  stt: SttProvider;
  tts: TtsProvider;
}

export function createContainer(): Container {

  if (env.floeApiKey) {
    const search = new FloeSearchProvider(env.floeApiKey); 
    const llm = new FloeLLMProvider(env.floeApiKey, env.geminiModel);
    const stt = new FloeSTTProvider(env.floeApiKey, {
      languageCode: "en-IN",
      model: "nova-3"
    });
    const tts = new FloeTTSProvider(env.floeApiKey, {
      targetLanguageCode: "en-IN",
      model: "bulbul:v3",
      speaker: "shubh",
      sampleRate: undefined,
    });

    const agent = new ResearchAgent({ llm, search });
    return { agent, stt, tts };
  }

  console.warn("FLOE_API_KEY not set, falling back to individual Gemini, Exa, and Sarvam providers.");

  const missingKeys: string[] = [];
  if (!env.geminiApiKey) missingKeys.push("GEMINI_API_KEY");
  if (!env.exaApiKey) missingKeys.push("EXA_API_KEY");
  if (!env.sarvamApiKey) missingKeys.push("SARVAM_API_KEY");

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing API keys. Please set FLOE_API_KEY, OR provide the missing fallback keys: ${missingKeys.join(", ")}`
    );
  }

  const search = new ExaSearchProvider(env.exaApiKey as string);
  const llm = new GeminiLlmProvider(env.geminiApiKey as string, env.geminiModel);
  const stt = new SarvamSttProvider(env.sarvamApiKey as string, { languageCode: "en-IN" });
  const tts = new SarvamTtsProvider(env.sarvamApiKey as string, {
    targetLanguageCode: "en-IN",
  });

  const agent = new ResearchAgent({ llm, search });
  return { agent, stt, tts };
}