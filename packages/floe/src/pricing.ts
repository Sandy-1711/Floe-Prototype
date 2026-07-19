import type { Usage } from "./types.ts";

/**
 * Offline price map (USD per 1M tokens), floe-guard style: the agent can price a
 * call before it makes it, so a decision loop can *see* its own budget instead of
 * discovering the cost on next month's invoice.
 *
 * Numbers are list prices as of mid-2026 and are easy to override per deployment.
 */
export interface ModelPrice {
  inPerM: number;
  outPerM: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gemini-2.5-pro": { inPerM: 1.25, outPerM: 10.0 },
  "gemini-2.5-flash": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-2.5-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-1.5-flash": { inPerM: 0.075, outPerM: 0.3 },
};

/** Flat per-call price for non-token vendors, when they don't self-report USD. */
export const VENDOR_FLAT_USD: Record<string, number> = {
  exa: 0.005, //      one Exa search
  tavily: 0.008, //   one Tavily search
  deepgram: 0.0043, // ~one short utterance of STT
  cartesia: 0.02, //  ~one spoken sentence of TTS
};

export function priceModelCall(model: string, usage: Usage): number {
  const p = MODEL_PRICES[model];
  if (!p) {
    // Fail loud-ish but don't crash a demo: assume a mid-tier rate.
    const fallback: ModelPrice = { inPerM: 0.5, outPerM: 1.5 };
    return round6(
      (usage.promptTokens * fallback.inPerM +
        usage.completionTokens * fallback.outPerM) /
        1_000_000,
    );
  }
  return round6(
    (usage.promptTokens * p.inPerM + usage.completionTokens * p.outPerM) /
      1_000_000,
  );
}

export function priceFlatVendor(vendor: string): number {
  return VENDOR_FLAT_USD[vendor] ?? 0.001;
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
