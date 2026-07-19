import type { Speech } from "@repo/agent";
import { TtsProvider } from "@repo/agent";

interface FloeTTSProviderOptions {
    targetLanguageCode?: string;
    model: string;
    speaker: string;
    sampleRate?: number;
}

export class FloeTTSProvider implements TtsProvider {

    #apiKey: string;
    #targetLanguageCode: string | undefined;
    #model: string;
    #speaker: string;
    #sampleRate: number | undefined;

    constructor(apiKey: string, opts: FloeTTSProviderOptions) {
        this.#apiKey = apiKey;
        this.#targetLanguageCode = opts.targetLanguageCode || "en-IN";
        this.#model = opts.model || "bulbul:v3";
        this.#speaker = opts.speaker || "shubh";
        this.#sampleRate = opts.sampleRate;
    }
    async synthesize(text: string): Promise<Speech> {

        const res = await fetch("https://credit-api.floelabs.xyz/v1/proxy/fetch", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.#apiKey}`,
                "Content-Type": "application/json",
                "Idempotency-Key": crypto.randomUUID()
            },
            body: JSON.stringify({
                url: "https://marketplace.floelabs.xyz/v1/tts/sarvam",
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "text": text,
                    "target_language_code": this.#targetLanguageCode,
                    "speaker": this.#speaker,
                    "model": this.#model,
                    ...(this.#sampleRate
                        ? { speech_sample_rate: this.#sampleRate }
                        : {}),
                })
            }),
        });
        const cost = res.headers.get("X-Floe-Payment-Amount");
        const json = await res.json();
        return {
            audio: base64ToBytes(json.audios?.[0] ?? ""),
            contentType: "audio/wav",
            cost: cost ? parseFloat(cost) : undefined
        }
    }
}
function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
