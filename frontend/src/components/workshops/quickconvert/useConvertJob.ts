// Quick Convert: start the conversion job, poll it (~0.5 s while live), cancel it.
// The queue is poll-based (routes/jobs_api): no WebSocket.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelConvert,
  convertJob,
  convertJobResult,
  startConvert,
  type ConvertResult,
  type RunRequest,
} from "../../../lib/api/convertQuick";

export interface JobView {
  phase: "idle" | "running" | "done" | "failed";
  progress: number;
  message: string;
  result: ConvertResult | null;
  error: string | null;
  /** The paths the run was started with, in order (rows map to entries by index). */
  paths: string[];
}

const IDLE: JobView = { phase: "idle", progress: 0, message: "", result: null, error: null, paths: [] };
const POLL_MS = 500;

export function useConvertJob() {
  const [job, setJob] = useState<JobView>(IDLE);
  const live = useRef<{ id: string | null; stop: boolean }>({ id: null, stop: false });

  useEffect(() => {
    const cur = live.current;
    return () => {
      cur.stop = true; // leaving the window ends the polling; the job itself finishes server-side
    };
  }, []);

  const start = useCallback(async (body: RunRequest) => {
    const cur = live.current;
    cur.stop = false;
    setJob({ ...IDLE, phase: "running", message: "Starting…", paths: body.paths });
    try {
      const id = await startConvert(body);
      cur.id = id;
      for (;;) {
        const snap = await convertJob(id);
        if (cur.stop) return;
        if (snap.status === "done") {
          const result = await convertJobResult(id);
          setJob((j) => ({ ...j, phase: "done", progress: 1, message: "", result }));
          return;
        }
        if (snap.status === "error" || snap.status === "cancelled") {
          const error = snap.status === "cancelled" ? "Cancelled." : snap.error || "The conversion failed.";
          setJob((j) => ({ ...j, phase: "failed", error }));
          return;
        }
        setJob((j) => ({ ...j, progress: snap.progress, message: snap.message }));
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      setJob((j) => ({ ...j, phase: "failed", error: e instanceof Error ? e.message : "The conversion failed." }));
    } finally {
      cur.id = null;
    }
  }, []);

  /** Stop after the current file; what is already written stays. */
  const cancel = useCallback(async () => {
    const id = live.current.id;
    if (id) await cancelConvert(id).catch(() => undefined);
  }, []);

  const reset = useCallback(() => setJob(IDLE), []);
  return { job, start, cancel, reset };
}
