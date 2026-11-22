// Shared workbench shell (lane WB): the guard around a tool's COMMIT when it
// writes through its own replayable path (a recorded transform: Signal
// Processing, its sigop filters, Reduce rows) rather than the analysis-output commit
// (`useAnalysisCommit`, which has the same in-flight guard built in).
//
// - IN-FLIGHT GUARD: while one commit is pending a second `run` is ignored and
//   resolves null, so two clicks make ONE output.
// - Cancel: `abort()` aborts the pending commit's signal and releases the
//   guard at once (a transport that cannot abort answers later, ignored by
//   the command); the tool's command must write nothing once aborted.
//   Unmount aborts too, so closing the window mid-commit leaves nothing.

import { useEffect, useRef, useState } from "react";

export interface WorkbenchCommit {
  /** True while a commit is pending. */
  busy: boolean;
  /** Run one commit; null when another is already pending. */
  run: <R>(commit: (signal: AbortSignal) => Promise<R>) => Promise<R | null>;
  /** Abort the pending commit (Cancel). */
  abort: () => void;
}

export function useWorkbenchCommit(): WorkbenchCommit {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => pending.current?.abort(), []);
  return {
    busy,
    abort: () => {
      if (!pending.current) return;
      pending.current.abort();
      pending.current = null;
      setBusy(false);
    },
    run: async (commit) => {
      if (pending.current) return null;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        return await commit(controller.signal);
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          setBusy(false);
        }
      }
    },
  };
}
