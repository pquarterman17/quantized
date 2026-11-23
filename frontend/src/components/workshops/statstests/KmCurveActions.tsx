// Statistical tests: the Kaplan-Meier "Add curve as worksheet / Add as plot"
// buttons (useKmCurveCommit). Rendered only for a Kaplan-Meier result.

import { Button } from "../../primitives";
import { useKmCurveCommit, type KmRun } from "./useKmCurveCommit";

export default function KmCurveActions({ km, stale }: { km: KmRun | null; stale: boolean }) {
  const c = useKmCurveCommit(km, stale);
  const why = c.disabledReason ?? undefined;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <Button size="sm" disabled={!!c.disabledReason} title={why ?? "Write the curve (time, S(t), 95% CI, at risk, events) to a new worksheet linked to this source."} onClick={c.addWorksheet}>
        Add curve as worksheet
      </Button>
      <Button size="sm" disabled={!!c.disabledReason} title={why ?? "Write the worksheet and draw the curve as a step plot in its own window."} onClick={c.addPlot}>
        Add as plot
      </Button>
    </div>
  );
}
