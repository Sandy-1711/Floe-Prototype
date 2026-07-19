import { BudgetGuard, BudgetExceeded } from "./budget.ts";
import { Ledger } from "./ledger.ts";
import { geminiGenerate } from "./adapters/gemini.ts";
import {
  priceModelCall,
  priceFlatVendor,
  round6,
  MODEL_PRICES,
} from "./pricing.ts";
import { shimLlm, shimSearch, type ShimHint } from "./shim.ts";
import type {
  FloeMode,
  FloeResult,
  LlmRequest,
  LlmResponse,
  SearchHit,
  SpendEvent,
  SpendSource,
  VendorCall,
} from "./types.ts";
// Type-only: erased at build, so the heavy Node-only SDK is loaded lazily below
// and never reaches a browser bundle.
import type { FloeAgent, BalanceResult } from "floe-agent";

export interface FloeClientOptions {
  /** "shim" runs fully offline with zero spend; "real" hits Floe + Gemini. */
  mode: FloeMode;
  /** FLOE_KEY (floe_* runtime key) — required in real mode for proxy calls. */
  floeApiKey?: string;
  /** Google AI Studio key — required in real mode for the Gemini adapter. */
  geminiApiKey?: string;
  /** Optional Floe credit-API base URL override (defaults to production). */
  baseUrl?: string;
  ledger?: Ledger;
  guard?: BudgetGuard;
  /** Groups spend under one task; also seeds idempotency keys. */
  taskId?: string;
}

export class FloeClient {
  readonly mode: FloeMode;
  readonly ledger: Ledger;
  readonly guard?: BudgetGuard;
  private readonly floeApiKey?: string;
  private readonly geminiApiKey?: string;
  private readonly baseUrl?: string;
  private readonly taskId: string;
  private _floe?: FloeAgent;

  constructor(opts: FloeClientOptions) {
    this.mode = opts.mode;
    this.ledger = opts.ledger ?? new Ledger();
    this.guard = opts.guard;
    this.floeApiKey = opts.floeApiKey;
    this.geminiApiKey = opts.geminiApiKey;
    this.baseUrl = opts.baseUrl;
    this.taskId = opts.taskId ?? crypto.randomUUID();
  }

  /** Lazily construct the official Floe SDK client (real mode only). */
  private async floe(): Promise<FloeAgent> {
    if (!this.floeApiKey) throw new Error("real mode needs floeApiKey (FLOE_KEY)");
    if (!this._floe) {
      const { FloeAgent } = await import("floe-agent");
      this._floe = new FloeAgent({
        apiKey: this.floeApiKey,
        ...(this.baseUrl ? { baseUrl: this.baseUrl } : {}),
      });
    }
    return this._floe;
  }

  /** True if the local spend control would block a call of this size. */
  private preflight(estimateUsd: number): boolean {
    if (!this.guard) return false;
    try {
      this.guard.check(estimateUsd);
      return false;
    } catch (err) {
      if (err instanceof BudgetExceeded) return true;
      throw err;
    }
  }

  private settle(params: {
    vendor: string;
    label: string;
    model?: string;
    amountUsd: number;
    source: SpendSource;
    meta?: Record<string, unknown>;
  }): SpendEvent {
    const event: SpendEvent = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      vendor: params.vendor,
      label: params.label,
      model: params.model,
      amountUsd: round6(params.amountUsd),
      source: params.source,
      meta: params.meta,
    };
    this.ledger.record(event);
    this.guard?.record(event.amountUsd);
    return event;
  }

  private blocked<T>(vendor: string, label: string, model?: string): FloeResult<T> {
    // Mirrors Floe's server-side spend control: 402 before any money moves.
    return {
      ok: false,
      status: 402,
      data: undefined as T,
      amountUsd: 0,
      event: {
        id: crypto.randomUUID(),
        ts: Date.now(),
        vendor,
        label,
        model,
        amountUsd: 0,
        source: this.mode === "real" ? "floe-proxy" : "shim",
        meta: { blocked: true, reason: "spend-control" },
      },
    };
  }

  /** LLM call. Gemini routes through our Floe-contract adapter; everything settles the same. */
  async llm(p: {
    label: string;
    model: string;
    request: LlmRequest;
    kind?: "plan" | "synthesize";
    shimHint?: ShimHint;
  }): Promise<FloeResult<LlmResponse>> {
    const estimate = this.estimateLlm(p.model, p.request);
    if (this.preflight(estimate)) return this.blocked("gemini", p.label, p.model);

    let resp: LlmResponse;
    let source: SpendSource;
    if (this.mode === "real") {
      if (!this.geminiApiKey) {
        throw new Error(
          "real mode needs geminiApiKey for the Gemini adapter (set GEMINI_API_KEY)",
        );
      }
      resp = await geminiGenerate(p.request, {
        apiKey: this.geminiApiKey,
        model: p.model,
      });
      source = "adapter";
    } else {
      resp = shimLlm(p.request, p.model, p.kind, p.shimHint);
      source = "shim";
    }

    const amountUsd = priceModelCall(resp.model, resp.usage);
    const event = this.settle({
      vendor: "gemini",
      label: p.label,
      model: resp.model,
      amountUsd,
      source,
      meta: { usage: resp.usage },
    });
    return { ok: true, status: 200, data: resp, amountUsd, event };
  }

  /** Web search, paid per call. Real mode routes through the Floe proxy (SDK). */
  async search(p: {
    label: string;
    vendor: "exa" | "tavily";
    query: string;
  }): Promise<FloeResult<SearchHit[]>> {
    const estimate = priceFlatVendor(p.vendor);
    if (this.preflight(estimate)) return this.blocked(p.vendor, p.label);

    let hits: SearchHit[];
    let amountUsd: number;
    let source: SpendSource;
    if (this.mode === "real") {
      try {
        const out = await this.proxySearch(p.vendor, p.query);
        hits = out.hits;
        amountUsd = out.amountUsd || estimate;
        source = "floe-proxy";
      } catch {
        // Never let a proxy hiccup kill the run — fall back and mark it.
        hits = shimSearch(p.query, p.vendor);
        amountUsd = estimate;
        source = "shim";
      }
    } else {
      hits = shimSearch(p.query, p.vendor);
      amountUsd = estimate;
      source = "shim";
    }

    const event = this.settle({
      vendor: p.vendor,
      label: p.label,
      amountUsd,
      source,
    });
    return { ok: true, status: 200, data: hits, amountUsd, event };
  }

  /**
   * Raw pass-through to Floe via the official SDK (`FloeAgent.fetch`). Floe pays the
   * vendor and returns the dollar `cost`; we pass an idempotency key so a retry after a
   * timeout never double-charges.
   */
  async proxyFetch(
    vc: VendorCall & { idempotencyKey?: string },
  ): Promise<{ data: unknown; amountUsd: number; status: number }> {
    const floe = await this.floe();
    const res = await floe.fetch({
      url: vc.url ?? "",
      method: vc.method ?? "GET",
      headers: vc.headers,
      body: vc.body === undefined ? undefined : JSON.stringify(vc.body),
      idempotencyKey: vc.idempotencyKey,
    });
    let data: unknown = res.body;
    try {
      data = JSON.parse(res.body);
    } catch {
      /* leave as string */
    }
    return { data, amountUsd: res.cost, status: res.status };
  }

  /** Spendable balance breakdown — proves the key works without spending. */
  async getBalance(): Promise<BalanceResult> {
    const floe = await this.floe();
    return floe.balanceDetails();
  }

  private async proxySearch(
    vendor: "exa" | "tavily",
    query: string,
  ): Promise<{ hits: SearchHit[]; amountUsd: number }> {
    // Floe injects the vendor key server-side; we only send the vendor's own payload.
    const url =
      vendor === "exa"
        ? "https://api.exa.ai/search"
        : "https://api.tavily.com/search";
    const body =
      vendor === "exa"
        ? { query, numResults: 3, contents: { text: true } }
        : { query, max_results: 3 };
    const { data, amountUsd } = await this.proxyFetch({
      vendor,
      url,
      method: "POST",
      body,
      idempotencyKey: `${this.taskId}:${vendor}:${query}`,
    });
    return { hits: normalizeSearch(data), amountUsd };
  }

  private estimateLlm(model: string, req: LlmRequest): number {
    const promptTokens = Math.ceil(((req.system ?? "") + req.prompt).length / 4);
    const completionTokens = req.maxOutputTokens ?? 512;
    const price = MODEL_PRICES[model];
    if (!price) return round6((promptTokens + completionTokens) * 1e-6);
    return round6(
      (promptTokens * price.inPerM + completionTokens * price.outPerM) /
        1_000_000,
    );
  }
}

function normalizeSearch(data: unknown): SearchHit[] {
  const d = data as {
    results?: Array<{
      title?: string;
      url?: string;
      text?: string;
      snippet?: string;
      content?: string;
    }>;
  };
  const results = d?.results ?? [];
  return results.slice(0, 3).map((r) => ({
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    snippet: (r.text ?? r.snippet ?? r.content ?? "").slice(0, 240),
  }));
}
