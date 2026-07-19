import type { Speech } from "@repo/agent";
import { TtsProvider } from "@repo/agent";
export class FloeTTSProvider implements TtsProvider {
    async synthesize(text: string): Promise<Speech> {
        // Placeholder Implementation: Replace with actual Floe TTS API call
        return {
            audio: new Uint8Array(),
            contentType: "audio/wav",
        }
    }
}