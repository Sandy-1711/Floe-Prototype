import { useCallback, useRef, useState } from "react";

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }, []);

  const stop = useCallback(
    () =>
      new Promise<Blob>((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder) return resolve(new Blob());
        recorder.onstop = () => {
          recorder.stream.getTracks().forEach((t) => t.stop());
          setRecording(false);
          resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
        };
        recorder.stop();
      }),
    [],
  );

  return { recording, start, stop };
}
