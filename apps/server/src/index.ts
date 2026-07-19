import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { createContainer } from "./container.ts";
import { env } from "./env.ts";

const container = createContainer();
const app = new Hono();

app.use("/api/*", cors({ origin: env.webOrigin }));

app.get("/health", (c) => c.json({ ok: true }));

app.post("/api/stt", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "expected a 'file' field" }, 400);
  }
  const audio = new Uint8Array(await file.arrayBuffer());
  const transcript = await container.stt.transcribe(
    audio,
    file.type || "audio/webm",
  );
  return c.json(transcript);
});

app.post("/api/agent", async (c) => {
  const { question } = await c.req.json<{ question?: string }>();
  if (!question?.trim()) return c.json({ error: "question is required" }, 400);

  c.header("Content-Type", "application/x-ndjson");
  c.header("Cache-Control", "no-cache");
  return stream(c, async (s) => {
    try {
      for await (const event of container.agent.run(question)) {
        await s.write(JSON.stringify(event) + "\n");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await s.write(JSON.stringify({ type: "error", message }) + "\n");
    }
  });
});

app.post("/api/tts", async (c) => {
  const { text } = await c.req.json<{ text?: string }>();
  if (!text?.trim()) return c.json({ error: "text is required" }, 400);
  const speech = await container.tts.synthesize(text);
  return new Response(new Uint8Array(speech.audio), {
    headers: { "Content-Type": speech.contentType },
  });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
