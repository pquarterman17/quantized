// Inspector control: explicit X/Y axis ranges (the W6 plot-state "limits"). A
// filled min+max fixes the axis (Origin-style); a blank side is auto for THAT
// side (a half-open limit — `lib/axisLim.ts`, P2.8 residual (b)): the other
// side is honoured and the canvas fills the blank one from its autoscale
// extent. Clearing both restores full autoscale; a non-numeric entry, or two
// typed sides with min >= max, leaves the committed range untouched AND puts
// the fields back to it (with an inline note), so the panel always shows what
// the plot applies. Commits
// on blur / Enter so typing isn't reformatted mid-edit. Lives in the Axes
// card; the range is resolved and applied by PlotViewport (useResolvedLims).

import { useEffect, useState } from "react";

import type { HalfLim } from "../../lib/axisLim";
import { limFieldDisplay, limFieldUnchanged, parseLimFields } from "../../lib/axisLimFields";
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
    setXMin(limFieldDisplay(xLim, 0));
    setXMax(limFieldDisplay(xLim, 1));
  }, [xLim]);
  useEffect(() => {
    setYMin(limFieldDisplay(yLim, 0));
    setYMax(limFieldDisplay(yLim, 1));
  }, [yLim]);

  const [err, setErr] = useState<Record<string, string>>({});

  const commit = (
    axis: string,
    minStr: string,
    maxStr: string,
    set: (v: Lim) => void,
    applied: Lim,
    setMin: (s: string) => void,
    setMax: (s: string) => void,
  ): void => {
    if (limFieldUnchanged(applied, minStr, maxStr)) return; // untouched: keep the full-precision limit
    // both blank → autoscale; one blank → auto for that side; invalid → revert
    const next = parseLimFields(minStr, maxStr);
    if (next !== undefined) {
      set(next); // (the message stays until the next edit: the blur after Enter re-commits the reverted text)
      return;
    }
    const lo = minStr.trim();
    const hi = maxStr.trim();
    const numeric = (t: string) => t === "" || Number.isFinite(Number(t));
    setErr((e) => ({
      ...e,
      [axis]: numeric(lo) && numeric(hi) ? "Minimum must be below maximum" : "Enter a number",
    }));
    setMin(limFieldDisplay(applied, 0));
    setMax(limFieldDisplay(applied, 1));
  };

  const row = (
    label: string,
    minV: string,
    maxV: string,
    setMin: (s: string) => void,
    setMax: (s: string) => void,
    onCommit: () => void,
  ) => (
    <div style={{ marginTop: 6 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 14 }}>
        {label}
      </span>
      <NumberField
        value={minV}
        width={88}
        placeholder="auto"
        aria-label={`${label} axis minimum`}
        title={minV}
        onChange={(v) => {
          setMin(v);
          setErr((e) => (e[label] ? { ...e, [label]: "" } : e));
        }}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit()}
      />
      <span style={{ color: "var(--text-faint)" }}>–</span>
      <NumberField
        value={maxV}
        width={88}
        placeholder="auto"
        aria-label={`${label} axis maximum`}
        title={maxV}
        onChange={(v) => {
          setMax(v);
          setErr((e) => (e[label] ? { ...e, [label]: "" } : e));
        }}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit()}
      />
    </div>
    {err[label] ? (
      <div role="alert" style={{ color: "var(--danger)", fontSize: 11, marginTop: 2 }}>
        {err[label]}
      </div>
    ) : null}
    </div>
  );

  return (
    <div style={{ marginTop: 8 }}>
      <span className="qzk-field-lbl">Limits</span>
      {row("X", xMin, xMax, setXMin, setXMax, () => commit("X", xMin, xMax, setXLim, xLim, setXMin, setXMax))}
      {row("Y", yMin, yMax, setYMin, setYMax, () => commit("Y", yMin, yMax, setYLim, yLim, setYMin, setYMax))}
    </div>
  );
}
