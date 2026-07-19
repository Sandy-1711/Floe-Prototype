"use client";

import { useEffect, useRef, useState } from "react";
import {
  runAgent,
  synthesize,
  transcribe,
  type AgentEvent,
} from "./lib/api";
import { useRecorder } from "./lib/useRecorder";
import styles from "./page.module.css";

interface TraceItem {
  kind: "thought" | "search";
  text: string;
  meta?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  trace?: TraceItem[];
  cost?: number;
  streaming?: boolean;
}

const usd = (n: number) => `$${n.toFixed(4)}`;

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const { recording, start, stop } = useRecorder();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const sessionCost = messages.reduce((sum, m) => sum + (m.cost ?? 0), 0);

  async function speak(text: string) {
    try {
      const blob = await synthesize(text);
      const url = URL.createObjectURL(blob);
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      /* playback is best-effort */
    }
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || running) return;

    const answerId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text: q },
      { id: answerId, role: "assistant", text: "", trace: [], streaming: true },
    ]);
    setRunning(true);
    setStatus(null);

    const patch = (fn: (m: Message) => Message) =>
      setMessages((list) => list.map((m) => (m.id === answerId ? fn(m) : m)));

    let answerText = "";
    try {
      for await (const event of runAgent(q)) {
        if (event.type === "delta") answerText += event.text;
        handle(event, patch);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setRunning(false);
      if (answerText.trim() && speakerOn) void speak(answerText);
    }
  }

  function handle(event: AgentEvent, patch: (fn: (m: Message) => Message) => void) {
    switch (event.type) {
      case "thought":
        patch((m) => ({
          ...m,
          trace: [...(m.trace ?? []), { kind: "thought", text: event.text }],
        }));
        break;
      case "search":
        patch((m) => ({
          ...m,
          trace: [
            ...(m.trace ?? []),
            { kind: "search", text: event.query, meta: `${event.hits.length} results` },
          ],
        }));
        break;
      case "delta":
        patch((m) => ({ ...m, text: m.text + event.text }));
        break;
      case "cost":
        patch((m) => ({ ...m, cost: event.total }));
        break;
      case "error":
        setStatus(`Error: ${event.message}`);
        break;
    }
  }

  async function onMic() {
    if (running) return;
    if (recording) {
      const blob = await stop();
      setStatus("Transcribing…");
      try {
        const { text } = await transcribe(blob);
        setStatus(null);
        if (text.trim()) await ask(text);
        else setStatus("Didn't catch that — try again.");
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      }
    } else {
      setStatus(null);
      await start();
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = input;
    setInput("");
    void ask(q);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Floe Voice Agent</h1>
          <p className={styles.subtitle}>
            Ask by voice or text — it searches the web and talks back.
          </p>
        </div>
        <div className={styles.meter} title="Total spent this session, via Floe">
          <span className={styles.meterLabel}>session</span>
          <span className={styles.meterValue}>{usd(sessionCost)}</span>
        </div>
      </header>

      <div className={styles.chat} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles.hint}>
            Try: “What is the x402 payment protocol?” — tap the mic or type below.
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className={`${styles.bubble} ${styles.user}`}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={styles.answerBlock}>
              {m.trace && m.trace.length > 0 && (
                <div className={styles.trace}>
                  {m.trace.map((t, i) => (
                    <div key={i} className={styles.traceRow}>
                      <span className={styles.tag}>{t.kind}</span>
                      <span className={styles.traceText}>{t.text}</span>
                      {t.meta && <span className={styles.dim}> · {t.meta}</span>}
                    </div>
                  ))}
                </div>
              )}
              {(m.text || m.streaming) && (
                <div className={`${styles.bubble} ${styles.assistant}`}>
                  {m.text}
                  {m.streaming && <span className={styles.caret} />}
                </div>
              )}
              {m.cost !== undefined && (
                <div className={styles.costRow}>{usd(m.cost)} via Floe</div>
              )}
            </div>
          ),
        )}
      </div>

      {status && <div className={styles.status}>{status}</div>}

      <form className={styles.composer} onSubmit={onSubmit}>
        <button
          type="button"
          onClick={onMic}
          disabled={running}
          className={`${styles.mic} ${recording ? styles.micLive : ""}`}
          title={recording ? "Stop and send" : "Record"}
        >
          {recording ? "◼" : "🎤"}
        </button>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={recording ? "Listening…" : "Ask something…"}
          disabled={running || recording}
        />
        <button
          type="button"
          onClick={() => setSpeakerOn((s) => !s)}
          className={styles.speaker}
          title={speakerOn ? "Mute replies" : "Speak replies"}
        >
          {speakerOn ? "🔊" : "🔇"}
        </button>
        <button
          type="submit"
          className={styles.send}
          disabled={running || recording || !input.trim()}
        >
          Send
        </button>
      </form>
    </main>
  );
}
