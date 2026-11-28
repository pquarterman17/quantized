// "Re-measure with state levels" on a rise / fall time saved with the band estimate (before the IEEE 181 state
// levels). Reopening such a step keeps its method, so its numbers do not move on their own; this is the user's
// choice to upgrade it. One click: switch the method, measure, and write the result through the normal commit
// (which replaces the saved output when the step was reopened with Replace), so Undo is one step.

import { useEffect, useState } from "react";

interface Args {
  method: "state" | "band";
  setMethod: (m: "state" | "band") => void;
  run: () => Promise<void>;
  add: () => void;
  hasResult: boolean;
  busy: boolean;
  error: string | null;
}

export function useStateLevelUpgrade(a: Args): { start: () => void } {
  const [phase, setPhase] = useState<"idle" | "measure" | "add">("idle");
  useEffect(() => {
    if (phase === "measure" && a.method === "state") {
      setPhase("add");
      void a.run();
    } else if (phase === "add" && !a.busy) {
      if (a.hasResult) a.add();
      if (a.hasResult || a.error) setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, a.method, a.busy, a.hasResult, a.error]);
  return { start: () => { setPhase("measure"); a.setMethod("state"); } };
}
