import type { GenerateMeta, GenerateRequest, GenerateResult } from "@repo/agent";
import { LlmProvider } from "@repo/agent";
import OpenAI from "openai";

const BASE_URL = "https://credit-api.floelabs.xyz/v1";

export class FloeLLMProvider implements LlmProvider {
    readonly model: string;
    #client: OpenAI;
    #apiKey: string;

    constructor(apiKey: string, model: string) {
        this.model = model;
        this.#apiKey = apiKey;
        this.#client = new OpenAI({ baseURL: BASE_URL, apiKey });
    }

    async generate(req: GenerateRequest): Promise<GenerateResult> {
        const { data, response } = await this.#client.chat.completions
            .create({
                model: this.model,
                messages: this.#messages(req),
                max_tokens: req.maxOutputTokens ?? req.maxTokens,
                ...(req.temperature !== undefined && { temperature: req.temperature }),
                ...(req.topP !== undefined && { top_p: req.topP }),
                ...(req.stop !== undefined && { stop: req.stop }),
            })
            .withResponse();

        const usage = {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
        };
        return {
            text: data.choices[0]?.message.content ?? "",
            usage,
            cost: this.#cost(response),
        };
    }

    async *generateStream(
        req: GenerateRequest,
    ): AsyncGenerator<string, GenerateMeta> {
        const { data: stream, response } = await this.#client.chat.completions
            .create({
                model: this.model,
                messages: this.#messages(req),
                max_tokens: req.maxOutputTokens ?? req.maxTokens,
                stream: true,
                stream_options: { include_usage: true },
                ...(req.temperature !== undefined && { temperature: req.temperature }),
            })
            .withResponse();

        let usage = { promptTokens: 0, completionTokens: 0 };
        let chunks = 0;
        const started = Date.now();
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
                chunks++;
                yield delta;
            }
            if (chunk.usage) {
                usage = {
                    promptTokens: chunk.usage.prompt_tokens ?? 0,
                    completionTokens: chunk.usage.completion_tokens ?? 0,
                };
            }
        }
        console.log(`[floe/llm] stream: ${chunks} chunks in ${Date.now() - started}ms`);
        return { usage, cost: this.#cost(response) };
    }

    #messages(req: GenerateRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (req.system) messages.push({ role: "system", content: req.system });
        messages.push({ role: "user", content: req.prompt });
        return messages;
    }

    // Read Floe's actual charge from the payment header. (#estimate is kept below
    // for manual use but is no longer part of the cost path.)
    #cost(response: Response): number | undefined {
        const header = response.headers.get("x-floe-payment-amount");
        if (!header) {
            console.log(`[floe/llm] no payment header`);
            return undefined;
        }
        console.log(`[floe/llm] cost from HEADER: $${header}`);
        return parseFloat(header);
    }

    async #estimate(
        inputTokens: number,
        outputTokens: number,
    ): Promise<number | undefined> {
        try {
            const res = await fetch(`${BASE_URL}/estimate`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.#apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: this.model,
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                }),
            });
            const json = (await res.json()) as { cost_usdc?: string | number };
            return json.cost_usdc !== undefined ? Number(json.cost_usdc) : undefined;
        } catch {
            return undefined;
        }
    }
}
