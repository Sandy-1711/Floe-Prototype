import type { SttProvider } from "@repo/agent";
import type { Transcript, WordTiming } from "@repo/agent";
import { fetchProxy } from "../utils/fetchproxy.ts";

interface SttResponse {
    transcript?: string;
    language_code?: string | null;
    timestamps?: {
        words?: string[];
        start_time_seconds?: number[];
        end_time_seconds?: number[];
    } | null;
}

export interface FloeSttOptions {
    model?: string;
    languageCode?: string;
}

export class FloeSTTProvider implements SttProvider {
    #apiKey: string;
    #opts: FloeSttOptions;

    constructor(apiKey: string, opts: FloeSttOptions = {}) {
        this.#apiKey = apiKey;
        this.#opts = opts;
    }

    async transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript> {

        const baseType = mimeType.split(";")[0] || "audio/webm";

        // Convert Uint8Array to a Base64 Data URI so it can be safely sent inside a JSON payload
        const base64Audio = bytesToBase64(audio);
        const audioUrl = `data:${baseType};base64,${base64Audio}`;

        const requestBody = {
            audioUrl: audioUrl,
            model: this.#opts.model ?? "saaras:v2.5",
            ...(this.#opts.languageCode !== undefined && { language_code: this.#opts.languageCode })
        };

        const res = await fetchProxy(
            this.#apiKey,
            "https://marketplace.floelabs.xyz/v1/stt/deepgram",
            requestBody
        );

        if (!res.ok) {
            throw new Error(`floe proxy stt error: ${res.status} ${await res.text()}`);
        }

        const cost = res.headers.get("X-Floe-Payment-Amount")

        const json = (await res.json()) as SttResponse;

        return {
            text: json.transcript ?? "",
            languageCode: json.language_code ?? undefined,
            words: mapWords(json.timestamps),
            cost: cost ? parseFloat(cost) : undefined,
        };
    }
}


function mapWords(ts: SttResponse["timestamps"]): WordTiming[] {
    const words = ts?.words ?? [];
    const starts = ts?.start_time_seconds ?? [];
    const ends = ts?.end_time_seconds ?? [];
    return words.map((word, i) => ({
        word,
        start: starts[i] ?? 0,
        end: ends[i] ?? 0,
    }));
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i] || 0);
    }
    return btoa(binary);
}