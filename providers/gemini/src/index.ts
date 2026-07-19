import type { LlmProvider, GenerateRequest, GenerateResult } from "@repo/agent";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiLlmProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    readonly model = "gemini-2.5-flash",
  ) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const body = {
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens ?? 1024,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
      ...(req.system
        ? { systemInstruction: { parts: [{ text: req.system }] } }
        : {}),
    };

    const res = await fetch(
      `${BASE}/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(
        `gemini ${this.model}: ${res.status} ${await res.text()}`,
      );
    }

    const json = (await res.json()) as GeminiResponse;
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "";
    return {
      text,
      usage: {
        promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
