// The chip's part for the curve-measurement gadget kinds (intersect,
// interpolate, rise time): intersect's second-curve picker and each kind's
// readout. The numbers are the measurement panel's own (lib/gadgetMeasure).

import { fmtNum } from "../../lib/format";
import { gadgetCurve } from "../../lib/quickfit";
import { useActiveDataset, useApp } from "../../store/useApp";
import { Select } from "../primitives";
import type { GadgetChipState } from "./useGadgetChip";

const MAX_SHOWN = 4;

export default function GadgetMeasureChip({ gadget }: { gadget: GadgetChipState }) {
  const active = useActiveDataset();
  // Separate selectors: an inline object selector would be a new snapshot every render.
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  // The measurement modes' own state is read here (this chunk is lazy), not through the eager chip hook.
  const m = useApp((s) => s.gadgetMeasure);
  const curveB = useApp((s) => s.gadgetCurveB);
  const setCurveB = useApp((s) => s.setGadgetCurveB);
  const { mode } = gadget;
  if (mode !== "intersect" && mode !== "interpolate" && mode !== "risetime") return null;
  const label = (yKey: number): string => active?.data.labels[yKey] || `Column ${yKey + 1}`;
  const ready = !gadget.busy && !gadget.error;
  const aKey = active ? (gadgetCurve(active, { xKey, yKeys, seriesOrder, hiddenChannels })?.yKey ?? null) : null;
  return (
    <>
      {mode === "intersect" && active && (
        <Select
          aria-label="Second curve"
          options={[
            { value: "", label: "next plotted curve" },
            ...active.data.labels.map((_, i) => ({ value: String(i), label: label(i) })).filter((o) => Number(o.value) !== aKey),
          ]}
          value={curveB === null || curveB === aKey ? "" : String(curveB)}
          onChange={(e) => setCurveB(e.target.value === "" ? null : Number(e.target.value))}
        />
      )}
      {ready && m?.mode === "intersect" && mode === "intersect" && (
        <>
          <span className="lbl">× {label(m.bKey)}</span>
          <span className="v">
            {m.r.intersections.length === 0
              ? "no intersection"
              : m.r.intersections.slice(0, MAX_SHOWN).map((p) => `x=${fmtNum(p.x)}`).join("  ") +
                (m.r.intersections.length > MAX_SHOWN ? `  +${m.r.intersections.length - MAX_SHOWN} more` : "")}
          </span>
        </>
      )}
      {ready && m?.mode === "risetime" && mode === "risetime" && (
        <>
          <span className="lbl">{m.r.edge === "rise" ? "rise time" : "fall time"}</span>
          <span className="v">{fmtNum(m.r.time)}</span>
          <span className="lbl">
            ({fmtNum(m.r.x_low)} → {fmtNum(m.r.x_high)})
          </span>
        </>
      )}
      {m?.mode === "interpolate" && mode === "interpolate" &&
        m.rows.map((row) => (
          <span key={row.yKey} className="v">
            {label(row.yKey)}: {row.y.map((v) => (v === null ? "—" : fmtNum(v))).join(" | ")}
          </span>
        ))}
    </>
  );
}
