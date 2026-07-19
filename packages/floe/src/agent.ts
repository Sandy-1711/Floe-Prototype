/**
 * A minimal research agent: plan → search → synthesize, powered by Gemini.
 *
 * It has no payment logic of its own. Instead it calls two capabilities you inject —
 * `llm` and `search` — so you can route them through Floe (or anything else) yourself.
 * That's the integration seam: wrap these two functions and every model/search call
 * the agent makes flows through your layer.
 */

export interface LlmRequest {
  system?: string;
  prompt: string;
  /** Ask the model to return a single JSON object. */
  json?: boolean;
  maxOutputTokens?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  /** Token usage when the provider reports it (handy for costing at your layer). */
  usage?: { promptTokens: number; completionTokens: number };
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** The two capabilities you provide. Wrap them to add Floe payments, budgets, etc. */
export interface AgentDeps {
  llm(model: string, req: LlmRequest): Promise<LlmResponse>;
  search(query: string): Promise<SearchHit[]>;
}

export type AgentStep =
  | { type: "status"; message: string }
  | { type: "plan"; queries: string[] }
  | { type: "search"; query: string; hits: SearchHit[] }
  | { type: "answer"; text: string };

export interface RunOptions {
  question: string;
  /** Gemini model id passed to your `llm`. Default: gemini-2.5-flash. */
  model?: string;
  /** Cap on the number of parallel searches. Default: 3. */
  maxSearches?: number;
  /** Observe each step (drive a UI, log, etc.). */
  onStep?: (step: AgentStep) => void;
}

export interface AgentResult {
  answer: string;
  queries: string[];
  hits: SearchHit[];
}

export async function runResearchAgent(
  deps: AgentDeps,
  opts: RunOptions,
): Promise<AgentResult> {
  const model = opts.model ?? "gemini-2.5-flash";
  const maxSearches = opts.maxSearches ?? 3;
  const emit = (s: AgentStep) => opts.onStep?.(s);

  // 1) PLAN — ask the model for a few focused search queries.
  emit({ type: "status", message: `Planning research for: "${opts.question}"` });
  const planRes = await deps.llm(model, {
    system:
      "You are a research planner. Given a question, return ONLY a JSON object " +
      '{"queries": string[]} with 2-3 focused web-search queries.',
    prompt: opts.question,
    json: true,
    maxOutputTokens: 256,
  });
  const queries = parseQueries(planRes.text, opts.question).slice(0, maxSearches);
  emit({ type: "plan", queries });

  // 2) SEARCH — run the queries in parallel.
  emit({ type: "status", message: `Searching ${queries.length} source(s)…` });
  const results = await Promise.all(queries.map((q) => deps.search(q)));
  const hits: SearchHit[] = [];
  results.forEach((hitList, i) => {
    emit({ type: "search", query: queries[i] ?? "", hits: hitList });
    hits.push(...hitList);
  });

  // 3) SYNTHESIZE — turn the hits into a short, spoken-length answer.
  emit({ type: "status", message: "Writing the answer…" });
  const synthRes = await deps.llm(model, {
    system:
      "You are a concise voice assistant. Answer in 2-4 spoken sentences using the " +
      "provided search snippets. No markdown, no lists.",
    prompt:
      `Question: ${opts.question}\n\nSnippets:\n` +
      hits.map((h, i) => `[${i + 1}] ${h.title} — ${h.snippet}`).join("\n"),
    maxOutputTokens: 400,
  });
  emit({ type: "answer", text: synthRes.text });

  return { answer: synthRes.text, queries, hits };
}

function parseQueries(text: string, fallback: string): string[] {
  const tryParse = (s: string): string[] | null => {
    try {
      const obj = JSON.parse(s) as { queries?: unknown };
      if (Array.isArray(obj.queries)) {
        const qs = obj.queries.filter((q): q is string => typeof q === "string");
        if (qs.length) return qs;
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  // Direct parse, or grab the first {...} block if the model wrapped it in prose.
  const direct = tryParse(text);
  if (direct) return direct;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    const fromBlock = tryParse(match[0]);
    if (fromBlock) return fromBlock;
  }
  return [fallback];
}

/**
 * A ready-to-use Gemini `llm` implementation (direct Google AI Studio REST call).
 * Drop it into `AgentDeps` — or wrap it to pay through Floe:
 *
 *   const llm = (model, req) => floePay(() => geminiLlm(GEMINI_KEY)(model, req));
 */
export function geminiLlm(apiKey: string): AgentDeps["llm"] {
  return async (model, req) => {
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens ?? 1024,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`Gemini ${model} failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      text,
      model,
      usage: {
        promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  };
}
