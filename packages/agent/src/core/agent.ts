import type { LlmProvider, SearchProvider } from "./ports.ts";
import type {
  AgentDecision,
  AgentEvent,
  AgentResult,
  SearchHit,
} from "./types.ts";

export interface ResearchAgentConfig {
  llm: LlmProvider;
  search: SearchProvider;
  maxSteps?: number;
  searchLimit?: number;
}

const DECIDE_SYSTEM = `You are a research agent that answers a user's question by searching the web.
On each turn, reply with ONLY a JSON object:
  {"thought": string, "action": {"type": "search", "query": string}}
  {"thought": string, "action": {"type": "answer", "text": string}}
Search when you need facts you don't yet have. Answer once the observations are
enough. The final answer must be 2-4 spoken sentences: no markdown, no lists.`;

export class ResearchAgent {
  private readonly maxSteps: number;
  private readonly searchLimit: number;

  constructor(private readonly cfg: ResearchAgentConfig) {
    this.maxSteps = cfg.maxSteps ?? 5;
    this.searchLimit = cfg.searchLimit ?? 3;
  }

  async *run(question: string): AsyncGenerator<AgentEvent, AgentResult> {
    const observations: string[] = [];

    for (let step = 1; step <= this.maxSteps; step++) {
      const decision = await this.decide(question, observations, step);
      yield { type: "thought", step, text: decision.thought };

      if (decision.action.type === "answer") {
        yield { type: "answer", text: decision.action.text };
        return { answer: decision.action.text, steps: step };
      }

      const query = decision.action.query;
      const hits = await this.cfg.search.search(query, this.searchLimit);
      yield { type: "search", step, query, hits };
      observations.push(renderObservation(query, hits));
    }

    const answer = await this.forceAnswer(question, observations);
    yield { type: "answer", text: answer };
    return { answer, steps: this.maxSteps };
  }

  private async decide(
    question: string,
    observations: string[],
    step: number,
  ): Promise<AgentDecision> {
    const last = step === this.maxSteps;
    const res = await this.cfg.llm.generate({
      system: DECIDE_SYSTEM + (last ? "\nThis is your last turn: you must answer." : ""),
      prompt: promptWith(question, observations),
      json: true,
      maxOutputTokens: 512,
    });
    return parseDecision(res.text, question);
  }

  private async forceAnswer(
    question: string,
    observations: string[],
  ): Promise<string> {
    const res = await this.cfg.llm.generate({
      system:
        "Answer the question in 2-4 spoken sentences using the observations. " +
        "No markdown, no lists.",
      prompt: promptWith(question, observations),
      maxOutputTokens: 400,
    });
    return res.text.trim();
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
  const raw = extractJson(text);
  if (raw && isDecision(raw)) return raw;
  // A non-JSON reply is treated as the model's final answer.
  return { thought: "", action: { type: "answer", text: text.trim() || question } };
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isDecision(v: unknown): v is AgentDecision {
  const d = v as AgentDecision;
  if (!d || typeof d.thought !== "string" || !d.action) return false;
  if (d.action.type === "search") return typeof d.action.query === "string";
  if (d.action.type === "answer") return typeof d.action.text === "string";
  return false;
}
