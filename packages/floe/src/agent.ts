import type { FloeClient } from "./client.ts";
import type { Advisory } from "./budget.ts";
import type { SearchHit, SpendEvent } from "./types.ts";

/**
 * A budget-aware voice/research agent that pays for its own work through Floe.
 *
 * The point the Floe JD keeps making — "decision loops that don't know their own
 * budget" — shows up here concretely: before every paid step the agent reads its
 * budget advisory and, when it's running low, *downshifts itself* (cheaper model,
 * fewer searches, shorter answer) instead of blowing the cap. If a spend control
 * still trips (402), it degrades gracefully rather than crashing.
 */

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "advisory"; advisory: Advisory }
  | { type: "plan"; queries: string[]; model: string }
  | { type: "downshift"; from: string; to: string; reason: string }
  | { type: "spend"; event: SpendEvent }
  | { type: "search"; query: string; hits: SearchHit[] }
  | { type: "blocked"; label: string; reason: string }
  | { type: "answer"; text: string; model: string }
  | {
      type: "done";
      totalUsd: number;
      capUsd: number;
      byVendor: Record<string, number>;
    };

export interface AgentOptions {
  question: string;
  client: FloeClient;
  models?: { strong: string; cheap: string };
  maxSearches?: number;
  searchVendor?: "exa" | "tavily";
  onEvent?: (e: AgentEvent) => void;
}

export interface AgentResult {
  answer: string;
  totalUsd: number;
  events: SpendEvent[];
  downshifted: boolean;
}

const DEFAULT_MODELS = { strong: "gemini-2.5-pro", cheap: "gemini-2.5-flash" };

export async function runResearchAgent(
  opts: AgentOptions,
): Promise<AgentResult> {
  const { question, client } = opts;
  const models = opts.models ?? DEFAULT_MODELS;
  const searchVendor = opts.searchVendor ?? "exa";
  const maxSearches = opts.maxSearches ?? 3;
  const emit = (e: AgentEvent) => opts.onEvent?.(e);

  // Forward every ledger row to the UI as it lands.
  const unsub = client.ledger.onEvent((event) => emit({ type: "spend", event }));
  let downshifted = false;

  /** Read the budget and pick a model; announce a downshift when economizing. */
  const pick = (step: string): { model: string; adv?: Advisory } => {
    const adv = client.guard?.advisory();
    if (adv) emit({ type: "advisory", advisory: adv });
    if (adv?.nearLimit) {
      downshifted = true;
      emit({
        type: "downshift",
        from: models.strong,
        to: models.cheap,
        reason: `${step}: ${(adv.usedBps / 100).toFixed(0)}% of $${adv.capUsd.toFixed(2)} spent`,
      });
      return { model: models.cheap, adv };
    }
    return { model: models.strong, adv };
  };

  try {
    emit({ type: "status", message: `Planning research for: "${question}"` });

    // 1) PLAN — ask the model for a few focused search queries.
    const planPick = pick("plan");
    const planRes = await client.llm({
      label: "plan",
      model: planPick.model,
      request: {
        system:
          "You are a research planner. Given a question, return ONLY a JSON " +
          'object {"queries": string[]} with 2-3 focused web-search queries.',
        prompt: question,
        json: true,
        maxOutputTokens: 256,
      },
    });

    if (planRes.status === 402) {
      emit({ type: "blocked", label: "plan", reason: "out of budget before planning" });
      return finish("I ran out of budget before I could start. Try a smaller task.");
    }

    let queries = parseQueries(planRes.data.text, question);
    // Economize on the number of searches when the budget is tight.
    const budgetTight = planPick.adv?.nearLimit ?? false;
    if (budgetTight) queries = queries.slice(0, 1);
    else queries = queries.slice(0, maxSearches);
    emit({ type: "plan", queries, model: planPick.model });

    // 2) SEARCH — run the queries in parallel, each paid per call through Floe.
    emit({ type: "status", message: `Searching ${queries.length} source(s)…` });
    const searchResults = await Promise.all(
      queries.map((q, i) =>
        client.search({ label: `search ${i + 1}`, vendor: searchVendor, query: q }),
      ),
    );
    const hits: SearchHit[] = [];
    searchResults.forEach((r, i) => {
      if (!r.ok) {
        emit({
          type: "blocked",
          label: `search ${i + 1}`,
          reason: r.status === 402 ? "spend cap reached" : "search failed",
        });
        return;
      }
      emit({ type: "search", query: queries[i] ?? "", hits: r.data });
      hits.push(...r.data);
    });

    // 3) SYNTHESIZE — turn the hits into a spoken-length answer.
    const synthPick = pick("synthesize");
    emit({ type: "status", message: "Writing the answer…" });
    const synthRes = await client.llm({
      label: "synthesize",
      model: synthPick.model,
      request: {
        system:
          "You are a concise voice assistant. Answer in 2-4 spoken sentences " +
          "using the provided search snippets. No markdown, no lists.",
        prompt:
          `Question: ${question}\n\nSnippets:\n` +
          hits
            .map((h, i) => `[${i + 1}] ${h.title} — ${h.snippet}`)
            .join("\n"),
        maxOutputTokens: synthPick.adv?.nearLimit ? 160 : 400,
      },
    });

    if (synthRes.status === 402) {
      emit({ type: "blocked", label: "synthesize", reason: "spend cap reached" });
      return finish(
        hits.length
          ? `I found ${hits.length} sources but hit my spend cap before writing the full answer.`
          : "I hit my spend cap before I could answer.",
      );
    }

    emit({ type: "answer", text: synthRes.data.text, model: synthPick.model });
    return finish(synthRes.data.text);
  } finally {
    unsub();
  }

  function finish(answer: string): AgentResult {
    const totalUsd = client.ledger.totalUsd;
    emit({
      type: "done",
      totalUsd,
      capUsd: client.guard?.capUsd ?? 0,
      byVendor: client.ledger.byVendor(),
    });
    return { answer, totalUsd, events: client.ledger.events, downshifted };
  }
}

function parseQueries(text: string, fallback: string): string[] {
  try {
    const obj = JSON.parse(text) as { queries?: unknown };
    if (Array.isArray(obj.queries)) {
      const qs = obj.queries.filter((q): q is string => typeof q === "string");
      if (qs.length) return qs;
    }
  } catch {
    // Models sometimes wrap JSON in prose — grab the first {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]) as { queries?: unknown };
        if (Array.isArray(obj.queries)) {
          const qs = obj.queries.filter((q): q is string => typeof q === "string");
          if (qs.length) return qs;
        }
      } catch {
        /* fall through */
      }
    }
  }
  return [fallback];
}
