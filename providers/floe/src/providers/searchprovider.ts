import { SearchProvider } from "@repo/agent";
import type { SearchHit, SearchResults } from "@repo/agent";
import { fetchProxy } from "../utils/fetchproxy.ts";

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
  snippet?: string;
}

export class FloeSearchProvider implements SearchProvider {
  #apiKey: string;
  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async search(query: string, limit?: number): Promise<SearchResults> {
    const res = await fetchProxy(this.#apiKey, "https://api.exa.ai/search", {
      query,
      type: "auto",
      numResults: limit ?? 5,
      contents: { text: { maxCharacters: 500 } },
    });

    const cost = res.headers.get("X-Floe-Payment-Amount");
    const text = await res.text();

    if (!res.ok) {
      console.error(`[floe/search] proxy ${res.status}: ${text.slice(0, 300)}`);
      return { hits: [], cost: cost ? parseFloat(cost) : undefined };
    }

    // The proxy may return Exa's body directly or wrapped as { body: "<json>" }.
    let payload: { results?: ExaResult[] } = {};
    try {
      const data = JSON.parse(text) as { body?: string; results?: ExaResult[] };
      payload = typeof data.body === "string" ? JSON.parse(data.body) : data;
    } catch {
      /* leave empty */
    }

    const hits: SearchHit[] = (payload.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "(untitled)",
      url: r.url ?? "",
      snippet: (r.text ?? r.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
    }));

    return { hits, cost: cost ? parseFloat(cost) : undefined };
  }
}
