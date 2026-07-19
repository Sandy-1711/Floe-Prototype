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
        const cost = await this.#cost(response, usage);
        return {
            text: data.choices[0]?.message.content ?? "",
            usage,
            cost,
        };
    }

    async *generateStream(
        req: GenerateRequest,
    ): AsyncGenerator<string, GenerateMeta> {
        const stream = await this.#client.chat.completions.create({
            model: this.model,
            messages: this.#messages(req),
            max_tokens: req.maxOutputTokens ?? req.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
            ...(req.temperature !== undefined && { temperature: req.temperature }),
        });

        let usage = { promptTokens: 0, completionTokens: 0 };
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) yield delta;
            if (chunk.usage) {
                usage = {
                    promptTokens: chunk.usage.prompt_tokens ?? 0,
                    completionTokens: chunk.usage.completion_tokens ?? 0,
                };
            }
        }
        return { usage, cost: await this.#estimate(usage.promptTokens, usage.completionTokens) };
    }

    #messages(req: GenerateRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (req.system) messages.push({ role: "system", content: req.system });
        messages.push({ role: "user", content: req.prompt });
        return messages;
    }

    // Prefer Floe's payment header; fall back to a free estimate on the real usage.
    async #cost(
        response: Response,
        usage: { promptTokens: number; completionTokens: number },
    ): Promise<number | undefined> {
        const header = response.headers.get("x-floe-payment-amount");
        if (header) return parseFloat(header);
        return this.#estimate(usage.promptTokens, usage.completionTokens);
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
            console.log(`FloeLLMProvider: estimated cost for ${inputTokens} input tokens and ${outputTokens} output tokens: ${json.cost_usdc}`);
            return json.cost_usdc !== undefined ? Number(json.cost_usdc) : undefined;
        } catch {
            return undefined;
        }
    }
}
