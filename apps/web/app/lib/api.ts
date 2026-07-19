const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4111";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type AgentEvent =
  | { type: "thought"; step: number; text: string }
  | { type: "search"; step: number; query: string; hits: SearchHit[]; cost?: number }
  | { type: "delta"; text: string }
  | { type: "answer"; text: string }
  | { type: "cost"; stage: string; amount: number; total: number }
  | { type: "done"; totalCost: number }
  | { type: "error"; message: string };

export interface Transcript {
  text: string;
  languageCode?: string;
  words: { word: string; start: number; end: number }[];
}

export async function transcribe(audio: Blob): Promise<Transcript> {
  const form = new FormData();
  form.append("file", audio, "audio.webm");
  const res = await fetch(`${API}/api/stt`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`stt failed: ${res.status}`);
  return res.json();
}

export async function* runAgent(
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`agent failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as AgentEvent;
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as AgentEvent;
}

export async function synthesize(text: string): Promise<Blob> {
  const res = await fetch(`${API}/api/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`tts failed: ${res.status}`);
  return res.blob();
}
