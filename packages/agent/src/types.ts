export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResults {
  hits: SearchHit[];
  cost?: number;
}

export interface GenerateRequest {
  system?: string;
  prompt: string;
  json?: boolean;
  maxOutputTokens?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  n?: number;
  stop?: string | string[];
}

export interface GenerateResult {
  text: string;
  usage?: { promptTokens: number; completionTokens: number };
  cost?: number;
}

/** Returned by a streaming generate once the token stream ends. */
export interface GenerateMeta {
  cost?: number;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  languageCode?: string;
  words: WordTiming[];
  cost?: number;
}

export interface Speech {
  audio: Uint8Array;
  contentType: string;
  cost?: number;
}

export type AgentAction =
  | { type: "search"; query: string }
  | { type: "answer"; text?: string };

export interface AgentDecision {
  thought: string;
  action: AgentAction;
}

export type AgentEvent =
  | { type: "thought"; step: number; text: string }
  | {
      type: "search";
      step: number;
      query: string;
      hits: SearchHit[];
      cost?: number;
    }
  | { type: "delta"; text: string }
  | { type: "answer"; text: string }
  | { type: "cost"; stage: string; amount: number; total: number }
  | { type: "done"; totalCost: number }
  | { type: "error"; message: string };

export interface AgentResult {
  answer: string;
  steps: number;
  totalCost: number;
}
