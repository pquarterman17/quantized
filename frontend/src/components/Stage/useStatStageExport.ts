// The Stat Stage's "Export" action, gated on a SETTLED draw (BUGS: stat export
// mixed a pending draw with the current grouping).
//
// The compute effect is async, so after a pick changes there is a window where
// `groups`/`nestLabel`/`mode` already describe the new picks while the draw is
// still the previous one (undecorated: no slots, colour levels or y-domain of
// its own) or not set yet. An export built in that window mixed the two: a
// faceted plot fell through to the flat path, a bar plot exported nothing,
// a box dropped its empty slots and colour levels.
//
// Choice: Export WAITS for the fresh draw, then reads every input from one
// settled render — it is cheap (no extra compute, the draw is coming anyway)
// and the StatusBar Cancel (`runCancellable`'s signal) aborts the wait too.
// The inputs are read from a ref updated after every commit, never from the
// clicked render's closure, so a handler bound during a pending render still
// exports what the screen shows once it settles.

import { useCallback, useEffect, useRef } from "react";

import { runCancellable } from "../../store/pendingOps";
import { exportStatStage, type StatStageExportInputs } from "./statStageExport";

interface Latest {
  /** The draw this mode reads is not yet the one computed for the current picks. */
  pending: boolean;
  /** Null: no dataset, nothing to export. */
  inputs: StatStageExportInputs | null;
}

export function useStatStageExport(
  pending: boolean,
  inputs: StatStageExportInputs | null,
): (fmt: string) => Promise<boolean> {
  const latest = useRef<Latest>({ pending, inputs });
  const waiters = useRef(new Set<(err?: Error) => void>());

  useEffect(() => {
    latest.current = { pending, inputs };
    if (pending) return;
    const ws = [...waiters.current];
    waiters.current.clear();
    for (const w of ws) w();
  });
  useEffect(() => {
    const ws = waiters.current;
    return () => {
      for (const w of [...ws]) w(new Error("plot closed before export"));
      ws.clear();
    };
  }, []);

  return useCallback(async (fmt: string) => {
    const settled = (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const done = (err?: Error) => {
          waiters.current.delete(done);
          signal.removeEventListener("abort", onAbort);
          if (err) reject(err);
          else resolve();
        };
        const onAbort = () => done(new Error("export cancelled"));
        waiters.current.add(done);
        signal.addEventListener("abort", onAbort);
      });
    // P3.4: a StatusBar op whose Cancel aborts the wait and the render request.
    const r = await runCancellable("Exporting statistical plot…", async (signal) => {
      // Re-checked after every wake: a newer pick may have started another compute.
      while (latest.current.pending) {
        signal.throwIfAborted();
        await settled(signal);
      }
      const now = latest.current.inputs;
      if (now) await exportStatStage(fmt, now, signal);
    });
    return r !== null;
  }, []);
}
