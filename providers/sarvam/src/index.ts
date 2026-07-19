import type { SttProvider, TtsProvider } from "@repo/agent";
import type { Speech, Transcript, WordTiming } from "@repo/agent";

const STT_URL = "https://api.sarvam.ai/speech-to-text";
const TTS_URL = "https://api.sarvam.ai/text-to-speech";

interface SttResponse {
  transcript?: string;
  language_code?: string | null;
  timestamps?: {
    words?: string[];
    start_time_seconds?: number[];
    end_time_seconds?: number[];
  } | null;
}

export interface SarvamSttOptions {
  model?: string;
  languageCode?: string;
}

export class SarvamSttProvider implements SttProvider {
  constructor(
    private readonly apiKey: string,
    private readonly opts: SarvamSttOptions = {},
  ) {}

  async transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript> {
    // Sarvam validates against bare MIME types, so drop any ";codecs=..." suffix
    // that MediaRecorder attaches (e.g. "audio/webm;codecs=opus").
    const baseType = mimeType.split(";")[0] || "audio/webm";
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audio)], { type: baseType });
    form.append("file", blob, filename(baseType));
    form.append("model", this.opts.model ?? "saaras:v3");
    form.append("language_code", this.opts.languageCode ?? "unknown");

    const res = await fetch(STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": this.apiKey },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`sarvam stt: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as SttResponse;
    return {
      text: json.transcript ?? "",
      languageCode: json.language_code ?? undefined,
      words: mapWords(json.timestamps),
    };
  }
}

export interface SarvamTtsOptions {
  model?: string;
  speaker?: string;
  targetLanguageCode?: string;
  sampleRate?: number;
}

export class SarvamTtsProvider implements TtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly opts: SarvamTtsOptions = {},
  ) {}

  async synthesize(text: string): Promise<Speech> {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        target_language_code: this.opts.targetLanguageCode ?? "en-IN",
        model: this.opts.model ?? "bulbul:v3",
        speaker: this.opts.speaker ?? "shubh",
        ...(this.opts.sampleRate
          ? { speech_sample_rate: this.opts.sampleRate }
          : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`sarvam tts: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { audios?: string[] };
    return {
      audio: base64ToBytes(json.audios?.[0] ?? ""),
      contentType: "audio/wav",
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

function filename(mimeType: string): string {
  const ext = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
  return `audio.${ext}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
