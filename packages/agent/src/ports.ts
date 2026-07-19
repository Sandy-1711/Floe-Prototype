import type {
  GenerateRequest,
  GenerateResult,
  SearchHit,
  Speech,
  Transcript,
} from "./types.ts";

export interface LlmProvider {
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export interface SearchProvider {
  search(query: string, limit?: number): Promise<SearchHit[]>;
}

export interface SttProvider {
  transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript>;
}

export interface TtsProvider {
  synthesize(text: string): Promise<Speech>;
}
