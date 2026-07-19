import { SearchProvider } from "@repo/agent";
import type { SearchResults } from "@repo/agent";
export class FloeSearchProvider implements SearchProvider {
    #apiKey: string;
    constructor(apiKey: string) {
        this.#apiKey = apiKey;
    }
    async search(query: string, limit?: number): Promise<SearchResults> {

        const res = await fetch("https://credit-api.floelabs.xyz/v1/proxy/fetch", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.#apiKey}`,
                "Content-Type": "application/json",
                "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify({
                url: "https://api.exa.ai/search",
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    "query": query,
                    "type": "auto",
                    "numResults": limit ?? 5
                }),
            }),
        });

        const data = await res.json();

        const cost = res.headers.get("X-Floe-Payment-Amount");

        return {
            hits: data.hits ?? [],
            cost: cost ? parseFloat(cost) : undefined
        }
    }

}