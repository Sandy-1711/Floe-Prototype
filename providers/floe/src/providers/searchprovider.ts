import { SearchProvider } from "@repo/agent";
import type { SearchResults } from "@repo/agent";
import { fetchProxy } from "../utils/fetchproxy.ts";
export class FloeSearchProvider implements SearchProvider {
    #apiKey: string;
    constructor(apiKey: string) {
        this.#apiKey = apiKey;
    }
    async search(query: string, limit?: number): Promise<SearchResults> {

        const res = await fetchProxy(
            this.#apiKey,
            "https://api.exa.ai/search",
            {
                query: query,
                type: "auto",
                numResults: limit ?? 5
            }
        );

        const data = await res.json();

        const cost = res.headers.get("X-Floe-Payment-Amount");

        return {
            hits: data.hits ?? [],
            cost: cost ? parseFloat(cost) : undefined
        }
    }

}