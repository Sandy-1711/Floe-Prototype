import type { SearchProvider } from "../core/ports.ts";
import type { SearchHit } from "../core/types.ts";

interface ExaResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
  }>;
}

export class ExaSearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, limit = 3): Promise<SearchHit[]> {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: limit,
        contents: { text: { maxCharacters: 500 } },
      }),
    });
    if (!res.ok) {
      throw new Error(`exa search: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as ExaResponse;
    return (json.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "(untitled)",
      url: r.url ?? "",
      snippet: (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
    }));
  }
}
