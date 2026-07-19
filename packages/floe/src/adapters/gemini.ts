import type { LlmRequest, LlmResponse } from "../types.ts";

/**
 * The Gemini-for-Floe adapter.
 *
 * Floe's proxy does not front Google Gemini today (its LLM vendors are OpenAI,
 * Anthropic, Venice, Sarvam, and keyless open-weight inference). This is the missing
 * piece: Gemini exposed behind the exact same call/settle contract as every native
 * Floe vendor, so the agent — and the unified ledger — can't tell the difference.
 *
 * In a real deployment this logic lives inside Floe's proxy as a vendor adapter; here
 * it runs locally against the developer's Google key and reports the same
 * `X-Floe-Payment-Amount`-shaped cost the ledger expects.
 */

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: GeminiUsageMetadata;
}

export async function geminiGenerate(
  req: LlmRequest,
  opts: { apiKey: string; model: string },
): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      maxOutputTokens: req.maxOutputTokens ?? 1024,
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (req.system) {
    body.systemInstruction = { parts: [{ text: req.system }] };
  }

  const res = await fetch(
    `${GEMINI_BASE}/${opts.model}:generateContent?key=${opts.apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${opts.model} failed: ${res.status} ${detail}`);
  }

  const json = (await res.json()) as GeminiResponse;
  const text =
    json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";

  return {
    text,
    model: opts.model,
    usage: {
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
