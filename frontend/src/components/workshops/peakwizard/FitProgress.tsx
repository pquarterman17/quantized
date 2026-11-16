// Peak Analyzer step ④ — the running fit's progress and the way out of a fit
// too large for the time limit (UX audit 7 #8, lane UX-I). The fit runs
// synchronously on the server, so there is no iteration count to stream: the
// clock shows the elapsed time against the limit, and when the model is heavy
// (or the last fit stopped at the limit) "Fit the 8 strongest peaks" keeps
// the tallest included peaks and fits again.

import { useEffect, useState } from "react";

import { Button } from "../../primitives";
import { heavyModel, MODEL_FIT_TIME_LIMIT_S, STRONGEST_PEAKS, stoppedAtTimeLimit } from "./peakDefaults";
import type { PeakWizardState } from "./usePeakWizard";

const faint = { color: "var(--text-faint)" } as const;

/** Seconds since `busy` last turned on, ticking while it stays on. */
function useElapsed(busy: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t0 = performance.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 200);
    return () => window.clearInterval(id);
  }, [busy]);
  return elapsed;
}

export default function FitProgress({ w, free }: { w: PeakWizardState; free: number }) {
  const m = w.model;
  const elapsed = useElapsed(m.busy);
  const included = w.candidates.filter((c) => c.included).length;
  const offer = included > STRONGEST_PEAKS && !m.stale
    && (stoppedAtTimeLimit(m.result) || (!m.result && heavyModel(free, w.points)));
  return (
    <>
      {m.busy && (
        <div role="status" aria-label="fit progress" className="qzk-ds-meta" style={{ ...faint, marginTop: 6 }}>
          Fitting… {elapsed.toFixed(1)} s of the {MODEL_FIT_TIME_LIMIT_S} s limit
        </div>
      )}
      {offer && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <span className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn)", whiteSpace: "normal" }}>
            {m.result ? "This fit hit the time limit." : `${free} free parameters may not converge in ${MODEL_FIT_TIME_LIMIT_S} s.`}
          </span>
          <Button size="sm" onClick={w.fitStrongest}>
            Fit the {STRONGEST_PEAKS} strongest peaks
          </Button>
        </div>
      )}
    </>
  );
}
