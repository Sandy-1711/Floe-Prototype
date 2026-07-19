import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });

export const env = {
  port: Number(process.env.PORT ?? 4111),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  geminiApiKey: process.env.GEMINI_API_KEY,
  // Direct Gemini path wants the bare model id; the Floe path wants an
  // OpenAI-style provider-prefixed id. They are separate on purpose.
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  exaApiKey: process.env.EXA_API_KEY,
  sarvamApiKey: process.env.SARVAM_API_KEY,
  floeApiKey: process.env.FLOE_API_KEY,
  floeModel: process.env.FLOE_MODEL ?? "google/gemini-2.5-flash",
};