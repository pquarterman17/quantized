// Inspector control: explicit X/Y axis ranges (the W6 plot-state "limits"). A
// filled min+max fixes the axis (Origin-style); a blank side is auto for THAT
// side (a half-open limit — `lib/axisLim.ts`, P2.8 residual (b)): the other
// side is honoured and the canvas fills the blank one from its autoscale
// extent. Clearing both restores full autoscale; a non-numeric entry, or two
// typed sides with min >= max, leaves the committed range untouched. Commits
// on blur / Enter so typing isn't reformatted mid-edit. Lives in the Axes
// card; the range is resolved and applied by PlotViewport (useResolvedLims).

import { useEffect, useState } from "react";

import type { HalfLim } from "../../lib/axisLim";
import { limFieldText, parseLimFields } from "../../lib/axisLimFields";
import { useApp } from "../../store/useApp";
import { NumberField } from "../primitives/NumberField";

type Lim = HalfLim | null;

export default function AxisLimits() {
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
  const setXLim = useApp((s) => s.setXLim);
  const setYLim = useApp((s) => s.setYLim);

  const [xMin, setXMin] = useState("");
  const [xMax, setXMax] = useState("");
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");

  // Mirror store → fields when the limits change elsewhere (autoscale on dataset
  // switch, or a reset). Normalizes "1.50" → "1.5" after a commit, which is fine.
  useEffect(() => {
    setXMin(limFieldText(xLim, 0));
    setXMax(limFieldText(xLim, 1));
  }, [xLim]);
  useEffect(() => {
    setYMin(limFieldText(yLim, 0));
    setYMax(limFieldText(yLim, 1));
  }, [yLim]);

  const commit = (minStr: string, maxStr: string, set: (v: Lim) => void): void => {
    // both blank → autoscale; one blank → auto for that side; invalid → no-op
    const next = parseLimFields(minStr, maxStr);
    if (next !== undefined) set(next);
  };

  const row = (
    label: string,
    minV: string,
    maxV: string,
    setMin: (s: string) => void,
    setMax: (s: string) => void,
    onCommit: () => void,
  ) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 14 }}>
        {label}
      </span>
      <NumberField
        value={minV}
        width={64}
        placeholder="auto"
        aria-label={`${label} axis minimum`}
        onChange={setMin}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit()}
      />
      <span style={{ color: "var(--text-faint)" }}>–</span>
      <NumberField
        value={maxV}
        width={64}
        placeholder="auto"
        aria-label={`${label} axis maximum`}
        onChange={setMax}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit()}
      />
    </div>
  );

  return (
    <div style={{ marginTop: 8 }}>
      <span className="qzk-field-lbl">Limits</span>
      {row("X", xMin, xMax, setXMin, setXMax, () => commit(xMin, xMax, setXLim))}
      {row("Y", yMin, yMax, setYMin, setYMax, () => commit(yMin, yMax, setYLim))}
    </div>
  );
}
