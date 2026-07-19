import type {
  GenerateMeta,
  GenerateRequest,
  GenerateResult,
  Speech,
  Transcript,
  SearchResults,
} from "./types.ts";

export interface LlmProvider {
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /** Optional token stream; yields text chunks and returns cost/usage when done. */
  generateStream?(
    req: GenerateRequest,
  ): AsyncGenerator<string, GenerateMeta | void>;
}

export interface SearchProvider {
  search(query: string, limit?: number): Promise<SearchResults>;
}

export interface SttProvider {
  transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript>;
}

export interface TtsProvider {
  synthesize(text: string): Promise<Speech>;
}
