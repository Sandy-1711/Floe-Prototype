import { BudgetGuard, BudgetExceeded } from "./budget.ts";
import { Ledger } from "./ledger.ts";
import { geminiGenerate } from "./adapters/gemini.ts";
import {
  priceModelCall,
  priceFlatVendor,
  round6,
  MODEL_PRICES,
} from "./pricing.ts";
import type {
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
  /** FLOE_KEY (floe_* runtime key) — pays vendors through Floe's proxy. */
  floeApiKey: string;
  /** Google AI Studio key — used by the Gemini adapter (Floe doesn't front Gemini). */
  geminiApiKey: string;
  /** Optional Floe credit-API base URL override (defaults to production). */
  baseUrl?: string;
  ledger?: Ledger;
  guard?: BudgetGuard;
  /** Groups spend under one task; also seeds idempotency keys. */
  taskId?: string;
}

/**
 * One door to money. The agent calls `llm()` / `search()` and every call lands as a
 * single row on one ledger, whether Floe settled it directly (search) or our Gemini
 * adapter did (LLM). Payments go through the official `floe-agent` SDK.
 */
export class FloeClient {
  readonly ledger: Ledger;
  readonly guard?: BudgetGuard;
  private readonly floeApiKey: string;
  private readonly geminiApiKey: string;
  private readonly baseUrl?: string;
  private readonly taskId: string;
  private _floe?: FloeAgent;

  constructor(opts: FloeClientOptions) {
    this.ledger = opts.ledger ?? new Ledger();
    this.guard = opts.guard;
    this.floeApiKey = opts.floeApiKey;
    this.geminiApiKey = opts.geminiApiKey;
    this.baseUrl = opts.baseUrl;
    this.taskId = opts.taskId ?? crypto.randomUUID();
  }

  /** Lazily construct the official Floe SDK client. */
  private async floe(): Promise<FloeAgent> {
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

  private fail<T>(
    status: number,
    vendor: string,
    label: string,
    meta: Record<string, unknown>,
    model?: string,
  ): FloeResult<T> {
    return {
      ok: false,
      status,
      data: undefined as T,
      amountUsd: 0,
      event: {
        id: crypto.randomUUID(),
        ts: Date.now(),
        vendor,
        label,
        model,
        amountUsd: 0,
        source: "floe-proxy",
        meta,
      },
    };
  }

  /**
   * LLM call, routed through the Gemini-for-Floe adapter. Settles the same way a
   * native Floe vendor would, so the ledger can't tell the difference.
   */
  async llm(p: {
    label: string;
    model: string;
    request: LlmRequest;
  }): Promise<FloeResult<LlmResponse>> {
    const estimate = this.estimateLlm(p.model, p.request);
    // Mirrors Floe's server-side spend control: 402 before any money moves.
    if (this.preflight(estimate)) {
      return this.fail(402, "gemini", p.label, { blocked: true, reason: "spend-control" }, p.model);
    }

    const resp = await geminiGenerate(p.request, {
      apiKey: this.geminiApiKey,
      model: p.model,
    });
    const amountUsd = priceModelCall(resp.model, resp.usage);
    const event = this.settle({
      vendor: "gemini",
      label: p.label,
      model: resp.model,
      amountUsd,
      source: "adapter",
      meta: { usage: resp.usage },
    });
    return { ok: true, status: 200, data: resp, amountUsd, event };
  }

  /** Web search, paid per call through Floe's proxy. */
  async search(p: {
    label: string;
    vendor: "exa" | "tavily";
    query: string;
  }): Promise<FloeResult<SearchHit[]>> {
    const estimate = priceFlatVendor(p.vendor);
    if (this.preflight(estimate)) {
      return this.fail(402, p.vendor, p.label, { blocked: true, reason: "spend-control" });
    }

    try {
      const { hits, amountUsd, status } = await this.proxySearch(p.vendor, p.query);
      const event = this.settle({
        vendor: p.vendor,
        label: p.label,
        amountUsd: amountUsd || estimate,
        source: "floe-proxy",
      });
      return { ok: true, status, data: hits, amountUsd: event.amountUsd, event };
    } catch (err) {
      // No money moved on a failed proxy call — report it, don't fabricate results.
      return this.fail(502, p.vendor, p.label, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
  ): Promise<{ hits: SearchHit[]; amountUsd: number; status: number }> {
    // Floe injects the vendor key server-side; we only send the vendor's own payload.
    const url =
      vendor === "exa"
        ? "https://api.exa.ai/search"
        : "https://api.tavily.com/search";
    const body =
      vendor === "exa"
        ? { query, numResults: 3, contents: { text: true } }
        : { query, max_results: 3 };
    const { data, amountUsd, status } = await this.proxyFetch({
      vendor,
      url,
      method: "POST",
      body,
      idempotencyKey: `${this.taskId}:${vendor}:${query}`,
    });
    return { hits: normalizeSearch(data), amountUsd, status };
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
