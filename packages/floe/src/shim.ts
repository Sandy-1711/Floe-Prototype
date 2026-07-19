import type { LlmRequest, LlmResponse, SearchHit } from "./types.ts";

/**
 * Offline stand-ins so the whole agent — loop, ledger, budget downshift, UI — runs
 * with zero API keys and zero spend during development. Real mode never touches this;
 * it exists so you can build against the exact same shapes for free, then flip one env
 * var for the final paid run.
 */

export interface ShimHint {
  question?: string;
  hits?: SearchHit[];
}

function estTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

export function shimLlm(
  req: LlmRequest,
  model: string,
  kind: string | undefined,
  hint: ShimHint | undefined,
): LlmResponse {
  let text: string;

  if (kind === "plan") {
    const q = (hint?.question ?? "the topic").replace(/["\n]/g, " ").trim();
    const queries = [
      `${q} overview 2026`,
      `${q} best options comparison`,
      `${q} expert recommendation`,
    ];
    text = JSON.stringify({ queries });
  } else if (kind === "synthesize") {
    const q = hint?.question ?? "your question";
    const sources = (hint?.hits ?? [])
      .slice(0, 3)
      .map((h) => h.title)
      .join(", ");
    text =
      `Based on the sources${sources ? ` (${sources})` : ""}, here's the short ` +
      `answer to "${q}": the top pick balances price and quality, with two ` +
      `close runners-up depending on your priorities. [shim response — no model was called]`;
  } else {
    text = `[shim ${model}] ${req.prompt.slice(0, 80)}`;
  }

  return {
    text,
    model,
    usage: {
      promptTokens: estTokens((req.system ?? "") + req.prompt),
      completionTokens: estTokens(text),
    },
  };
}

export function shimSearch(query: string, vendor: string): SearchHit[] {
  return [1, 2, 3].map((i) => ({
    title: `${query} — result ${i}`,
    url: `https://example.com/${vendor}/${encodeURIComponent(query)}/${i}`,
    snippet: `A representative ${vendor} snippet about "${query}" (result ${i}). [shim]`,
  }));
}
