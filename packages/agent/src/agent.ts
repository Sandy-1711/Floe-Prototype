import type { LlmProvider, SearchProvider } from "./ports.ts";
import type {
  AgentDecision,
  AgentEvent,
  AgentResult,
  GenerateRequest,
  SearchHit,
} from "./types.ts";

export interface ResearchAgentConfig {
  llm: LlmProvider;
  search: SearchProvider;
  maxSteps?: number;
  searchLimit?: number;
}

const DECIDE_SYSTEM = `You are a research agent. Each turn, decide your NEXT single action and reply with ONLY one JSON object, nothing before or after:
  {"thought": "<one short sentence>", "action": {"type": "search", "query": "<query>"}}
  {"thought": "<one short sentence>", "action": {"type": "answer"}}
Use "search" when you still need facts. Use "answer" once the observations are enough. Output exactly one JSON object.`;

const ANSWER_SYSTEM = `You are a concise voice assistant. Using the observations, answer the question in 2-4 spoken sentences. No markdown, no lists, no citations.`;

export class ResearchAgent {
  private readonly maxSteps: number;
  private readonly searchLimit: number;

  constructor(private readonly cfg: ResearchAgentConfig) {
    this.maxSteps = cfg.maxSteps ?? 5;
    this.searchLimit = cfg.searchLimit ?? 3;
  }

  async *run(question: string): AsyncGenerator<AgentEvent, AgentResult> {
    const observations: string[] = [];
    let total = 0;
    let steps = 0;

    for (let step = 1; step <= this.maxSteps; step++) {
      steps = step;
      const { decision, cost } = await this.decide(question, observations, step);
      yield { type: "thought", step, text: decision.thought };
      if (cost) yield { type: "cost", stage: "reason", amount: cost, total: (total += cost) };

      if (decision.action.type === "answer") break;

      const query = decision.action.query;
      const { hits, cost: searchCost } = await this.cfg.search.search(query, this.searchLimit);
      yield { type: "search", step, query, hits, cost: searchCost };
      if (searchCost) yield { type: "cost", stage: "search", amount: searchCost, total: (total += searchCost) };
      observations.push(renderObservation(query, hits));
    }

    const meta = yield* this.streamAnswer(question, observations);
    if (meta.cost) yield { type: "cost", stage: "answer", amount: meta.cost, total: (total += meta.cost) };
    yield { type: "answer", text: meta.text };

    total = round(total);
    yield { type: "done", totalCost: total };
    return { answer: meta.text, steps, totalCost: total };
  }

  private async decide(
    question: string,
    observations: string[],
    step: number,
  ): Promise<{ decision: AgentDecision; cost?: number }> {
    const last = step === this.maxSteps;
    const res = await this.cfg.llm.generate({
      system: DECIDE_SYSTEM + (last ? "\nThis is your last turn: choose answer." : ""),
      prompt: promptWith(question, observations),
      json: true,
      maxOutputTokens: 300,
    });
    return { decision: parseDecision(res.text, question), cost: res.cost };
  }

  private async *streamAnswer(
    question: string,
    observations: string[],
  ): AsyncGenerator<AgentEvent, { text: string; cost?: number }> {
    const req: GenerateRequest = {
      system: ANSWER_SYSTEM,
      prompt: promptWith(question, observations),
      maxOutputTokens: 400,
    };

    if (this.cfg.llm.generateStream) {
      const iter = this.cfg.llm.generateStream(req);
      let full = "";
      let next = await iter.next();
      while (!next.done) {
        full += next.value;
        yield { type: "delta", text: next.value };
        next = await iter.next();
      }
      return { text: full.trim(), cost: next.value ? next.value.cost : undefined };
    }

    const res = await this.cfg.llm.generate(req);
    yield { type: "delta", text: res.text };
    return { text: res.text.trim(), cost: res.cost };
  }
}

function promptWith(question: string, observations: string[]): string {
  if (observations.length === 0) return `Question: ${question}`;
  return `Question: ${question}\n\nObservations:\n${observations.join("\n\n")}`;
}

function renderObservation(query: string, hits: SearchHit[]): string {
  const body = hits.map((h, i) => `  [${i + 1}] ${h.title} — ${h.snippet}`).join("\n");
  return `search("${query}"):\n${body || "  (no results)"}`;
}

function parseDecision(text: string, question: string): AgentDecision {
  const block = firstJsonObject(text);
  if (block) {
    try {
      const parsed = JSON.parse(block);
      if (isDecision(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return { thought: "", action: { type: "answer", text: text.trim() || question } };
}

// Extract the first balanced {...} block so a model that dumps several objects
// (common with smaller models) still yields one clean decision.
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function isDecision(v: unknown): v is AgentDecision {
  const d = v as AgentDecision;
  if (!d || typeof d.thought !== "string" || !d.action) return false;
  if (d.action.type === "search") return typeof d.action.query === "string";
  return d.action.type === "answer";
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
