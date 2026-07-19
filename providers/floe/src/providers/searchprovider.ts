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
    const data = (await res.json()) as { body?: string; results?: ExaResult[] };

    // The proxy may return Exa's body directly or wrapped as { body: "<json>" }.
    let payload: { results?: ExaResult[] } = data;
    if (typeof data.body === "string") {
      try {
        payload = JSON.parse(data.body);
      } catch {
        /* keep raw */
      }
    }

    const hits: SearchHit[] = (payload.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "(untitled)",
      url: r.url ?? "",
      snippet: (r.text ?? r.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
    }));

    return { hits, cost: cost ? parseFloat(cost) : undefined };
  }
}
