// Core contract shared by every path (real Floe proxy, Gemini adapter, local shim).
// The whole point of this SDK: the agent calls ONE interface and gets ONE ledger,
// no matter which vendor settled the money.

/** Who actually settled the payment for a call. */
export type SpendSource =
  | "floe-proxy" // paid through the real Floe x402 proxy
  | "adapter"; //   a Floe-contract-compatible adapter we wrote (e.g. Gemini)

/** A request the agent wants to make to some vendor, expressed once. */
export interface VendorCall {
  /** Stable vendor id, e.g. "gemini" | "exa" | "deepgram" | "cartesia". */
  vendor: string;
  /** Human label for the ledger row, e.g. "plan" or "search: keyboards". */
  label?: string;
  /** Vendor endpoint (used verbatim by the real Floe proxy). */
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Model hint, used for token pricing when the vendor doesn't self-report USD. */
  model?: string;
}

/** One line on the unified ledger. */
export interface SpendEvent {
  id: string;
  ts: number;
  vendor: string;
  label: string;
  model?: string;
  amountUsd: number;
  source: SpendSource;
  meta?: Record<string, unknown>;
}

/** Result of routing a VendorCall through Floe (or its stand-ins). */
export interface FloeResult<T = unknown> {
  ok: boolean;
  /** HTTP-ish status. 402 == blocked by a spend control before the call. */
  status: number;
  data: T;
  amountUsd: number;
  event: SpendEvent;
}

/** Token usage some vendors report; used for offline pricing. */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

/** A simplified LLM request the adapter translates to a vendor's native schema. */
export interface LlmRequest {
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  /** Ask the model to return a single JSON object. */
  json?: boolean;
}

export interface LlmResponse {
  text: string;
  usage: Usage;
  model: string;
}

/** One web-search hit, normalized across search vendors. */
export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}
