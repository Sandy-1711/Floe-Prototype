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

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [trace, setTrace] = useState<AgentEvent[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const { recording, start, stop } = useRecorder();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, trace]);

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
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: q }]);
    setTrace([]);
    setRunning(true);
    setStatus(null);
    try {
      for await (const event of runAgent(q)) {
        if (event.type === "answer") {
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: "assistant", text: event.text },
          ]);
          if (speakerOn) void speak(event.text);
        } else if (event.type === "error") {
          setStatus(`Error: ${event.message}`);
        } else {
          setTrace((t) => [...t, event]);
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
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

  const empty = messages.length === 0 && trace.length === 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Floe Voice Agent</h1>
        <p className={styles.subtitle}>
          Ask by voice or text — it searches the web and talks back.
        </p>
      </header>

      <div className={styles.chat} ref={scrollRef}>
        {empty && (
          <div className={styles.hint}>
            Try: “What is the x402 payment protocol?” — tap the mic or type below.
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`${styles.bubble} ${
              m.role === "user" ? styles.user : styles.assistant
            }`}
          >
            {m.text}
          </div>
        ))}

        {running && (
          <div className={styles.thinking}>
            {trace.length === 0 && <span className={styles.dim}>Thinking…</span>}
            {trace.map((e, i) =>
              e.type === "thought" ? (
                <div key={i} className={styles.traceRow}>
                  <span className={styles.tag}>think</span>
                  {e.text}
                </div>
              ) : e.type === "search" ? (
                <div key={i} className={styles.traceRow}>
                  <span className={styles.tag}>search</span>
                  <span className={styles.query}>{e.query}</span>
                  <span className={styles.dim}> · {e.hits.length} results</span>
                </div>
              ) : null,
            )}
          </div>
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
