import type { GenerateRequest, GenerateResult } from "@repo/agent";
import { LlmProvider } from "@repo/agent";
import OpenAI from "openai";

export interface EstimateResponse {
    cost_usdc: number;
    provider: string;
    rail: string;
}

export class FloeLLMProvider implements LlmProvider {

    #client: OpenAI;
    #apiKey: string;
    #model: string;

    constructor(private readonly apiKey: string, public readonly model: string) {
        this.#model = model;
        this.#apiKey = apiKey;
        this.#client = new OpenAI({
            baseURL: "https://credit-api.floelabs.xyz/v1",
            apiKey: this.apiKey,
        });
    }
    async generate(req: GenerateRequest): Promise<GenerateResult> {


        const messageBody: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (req.system) {
            messageBody.push({ role: "system", content: req.system });
        }
        messageBody.push({ role: "user", content: req.prompt });

        const requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
            model: this.#model,
            messages: messageBody,
            ...(req?.maxTokens !== undefined && { max_tokens: req.maxTokens }),
            ...(req?.temperature !== undefined && { temperature: req.temperature }),
            ...(req?.topP !== undefined && { top_p: req.topP }),
            ...(req?.n !== undefined && { n: req.n }),
            ...(req?.stop !== undefined && { stop: req.stop }),
        };

        const res = await this.#client.chat.completions.create(requestBody);

        const responseText = res.choices[0]?.message.content || "";
        return {
            text: responseText,
            usage: {
                promptTokens: res.usage?.prompt_tokens ?? 0,
                completionTokens: res.usage?.completion_tokens ?? 0,
            }
        }
    }

    async estimate(req: GenerateRequest): Promise<EstimateResponse> {
        const res = await fetch("https://credit-api.floelabs.xyz/v1/estimate", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.#apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ "model": this.#model, "input_tokens": 1200, "output_tokens": 400 }),
        });
        const json = await res.json();
        return json;
    }
}