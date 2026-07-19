import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4111),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  exaApiKey: required("EXA_API_KEY"),
  sarvamApiKey: required("SARVAM_API_KEY"),
};
