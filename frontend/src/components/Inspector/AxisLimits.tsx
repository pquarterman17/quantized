// Inspector control: explicit X/Y axis ranges (the W6 plot-state "limits"). A
// filled min+max fixes the axis (Origin-style); clearing both restores autoscale.
// Commits on blur / Enter so typing isn't reformatted mid-edit. Lives in the Axes
// card; the actual range is applied in uplotOpts via scales.{x,y}.range.

import { useEffect, useState } from "react";

import { useApp } from "../../store/useApp";
import { NumberField } from "../primitives";

type Lim = [number, number] | null;

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
    setXMin(xLim ? String(xLim[0]) : "");
    setXMax(xLim ? String(xLim[1]) : "");
  }, [xLim]);
  useEffect(() => {
    setYMin(yLim ? String(yLim[0]) : "");
    setYMax(yLim ? String(yLim[1]) : "");
  }, [yLim]);

  const commit = (minStr: string, maxStr: string, set: (v: Lim) => void): void => {
    if (minStr === "" && maxStr === "") {
      set(null); // both blank → autoscale
      return;
    }
    const lo = Number(minStr);
    const hi = Number(maxStr);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) set([lo, hi]);
    // partial / invalid (min ≥ max) → leave the current range untouched
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
        onChange={setMin}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit()}
      />
      <span style={{ color: "var(--text-faint)" }}>–</span>
      <NumberField
        value={maxV}
        width={64}
        placeholder="auto"
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
