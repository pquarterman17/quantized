// The chip's part for the curve-measurement gadget kinds (intersect, level
// crossings, interpolate, rise time): intersect's second-curve picker (a
// channel of this worksheet, or of another), each kind's settings and
// readout, with the units of the columns measured. The numbers are the
// measurement panel's own (lib/gadgetMeasure).

import { useState } from "react";

import { gadgetPlugins } from "../../lib/axisExtrasHook";
import { fmtNum } from "../../lib/format";
import { gadgetCurve } from "../../lib/quickfit";
import { toast } from "../../store/toasts";
import { useGadgetMeasureOptions } from "../../store/gadgetMeasureOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import { Button, Select } from "../primitives";
import GadgetHysteresisPointer from "./GadgetHysteresisPointer";
import GadgetMeasureOptions from "./GadgetMeasureOptions";
import type { GadgetChipState } from "./useGadgetChip";

const MAX_SHOWN = 4;

/** A number with its unit ("" = none). */
const withUnit = (v: number | null | undefined, unit: string): string => `${fmtNum(v)}${unit ? ` ${unit}` : ""}`;

export default function GadgetMeasureChip({ gadget }: { gadget: GadgetChipState }) {
  const active = useActiveDataset();
  // Separate selectors: an inline object selector would be a new snapshot every render.
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const datasets = useApp((s) => s.datasets);
  // The measurement modes' own state is read here (this chunk is lazy), not through the eager chip hook.
  const m = useApp((s) => s.gadgetMeasure);
  const curveB = useApp((s) => s.gadgetCurveB);
  const setCurveB = useApp((s) => s.setGadgetCurveB);
  const bSheet = useGadgetMeasureOptions((s) => s.options.curveBSheet);
  const setOptions = useGadgetMeasureOptions((s) => s.set);
  const activeId = useApp((s) => s.activeId);
  const setStatus = useApp((s) => s.setStatus);
  const [reporting, setReporting] = useState(false);
  // Why the plot shows no rings for this measurement (a turned plot, a waterfall), from the gadget chunk the plot loaded.
  const hidden = useApp((s) => (m ? (gadgetPlugins()?.measureWhy(s, m) ?? null) : null));
  const { mode } = gadget;
  if (mode !== "intersect" && mode !== "levelcrossing" && mode !== "interpolate" && mode !== "risetime") return null;
  const other = bSheet === null ? null : (datasets.find((d) => d.id === bSheet) ?? null);
  const bData = other ?? active;
  const label = (yKey: number, ds = active): string => ds?.data.labels[yKey] || `Column ${yKey + 1}`;
  const ready = !gadget.busy && !gadget.error;
  const aKey = active ? (gadgetCurve(active, { xKey, yKeys, seriesOrder, hiddenChannels })?.yKey ?? null) : null;
  const sheets = datasets.filter((d) => d.id !== active?.id && !d.pending);
  const u = m && m.mode !== "interpolate" ? m.units : null;
  // Commit and Report need a finished measurement of THIS mode that found something to write.
  const found = ready && m?.mode === mode && (m.mode === "intersect" ? m.r.intersections.length : m.mode === "levelcrossing" ? m.r.crossings.length : m.mode === "risetime" ? 2 : 0) > 0;
  // Both endings load their code on demand: the chip is lazy, the commit and report bodies are lazier.
  const commit = (measure: Exclude<NonNullable<typeof m>, { mode: "interpolate" }>) =>
    import("./gadgetMeasureCommit").then(
      (c) => c.commitGadgetMeasure({ m: measure, activeId, datasets, setStatus }),
      () => toast("could not load the commit code; try again", "danger"),
    );
  const report = async (ds: NonNullable<typeof active>, measure: Exclude<NonNullable<typeof m>, { mode: "interpolate" }>): Promise<void> => {
    setReporting(true);
    try {
      await (await import("./gadgetMeasureReport")).addMeasureReport(ds, measure);
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setReporting(false);
    }
  };
  return (
    <>
      {mode === "intersect" && active && (
        <>
          {sheets.length > 0 && (
            <Select
              aria-label="Second curve worksheet"
              options={[{ value: "", label: "this worksheet" }, ...sheets.map((d) => ({ value: d.id, label: d.name }))]}
              value={other ? other.id : ""}
              onChange={(e) => {
                setOptions({ curveBSheet: e.target.value === "" ? null : e.target.value });
                setCurveB(null); // the other sheet's channels are numbered differently: back to the default pick
              }}
            />
          )}
          <Select
            aria-label="Second curve"
            options={[
              { value: "", label: other ? "second column" : "next plotted curve" },
              ...(bData?.data.labels ?? []).map((_, i) => ({ value: String(i), label: label(i, bData) })).filter((o) => other || Number(o.value) !== aKey),
            ]}
            value={curveB === null || (!other && curveB === aKey) ? "" : String(curveB)}
            onChange={(e) => setCurveB(e.target.value === "" ? null : Number(e.target.value))}
          />
        </>
      )}
      {(mode === "levelcrossing" || mode === "risetime") && <GadgetMeasureOptions mode={mode} />}
      {ready && m?.mode === "intersect" && mode === "intersect" && u && (
        <>
          <span className="lbl">× {label(m.bKey, other ?? active)}</span>
          <span className="v">
            {m.r.intersections.length === 0
              ? "no intersection"
              : m.r.intersections.slice(0, MAX_SHOWN).map((p) => `x=${withUnit(p.x, u.x)} y=${withUnit(p.y, u.y)}`).join("  ") +
                (m.r.intersections.length > MAX_SHOWN ? `  +${m.r.intersections.length - MAX_SHOWN} more` : "")}
          </span>
        </>
      )}
      {ready && m?.mode === "levelcrossing" && mode === "levelcrossing" && u && (
        <>
          <span className="lbl">{m.auto ? "level (mid-range)" : "level"}</span>
          <span className="v">{withUnit(m.r.level, u.y)}</span>
          <span className="v">
            {m.r.crossings.length === 0
              ? "no crossing"
              : m.r.crossings.slice(0, MAX_SHOWN).map((c) => `${c.direction === "rising" ? "↑" : "↓"} x=${withUnit(c.x, u.x)}`).join("  ") +
                (m.r.crossings.length > MAX_SHOWN ? `  +${m.r.crossings.length - MAX_SHOWN} more` : "")}
          </span>
          <GadgetHysteresisPointer m={m} />
        </>
      )}
      {ready && m?.mode === "risetime" && mode === "risetime" && u && (
        <>
          <span className="lbl">{m.r.edge === "rise" ? "rise time" : "fall time"}</span>
          <span className="v">{withUnit(m.r.time, u.x)}</span>
          <span className="lbl">
            ({fmtNum(m.r.x_low)} → {fmtNum(m.r.x_high)}{u.x ? ` ${u.x}` : ""}; {withUnit(m.r.low_level, u.y)} → {withUnit(m.r.high_level, u.y)})
          </span>
        </>
      )}
      {m?.mode === "interpolate" && mode === "interpolate" &&
        m.rows.map((row) => (
          <span key={row.yKey} className="v">
            {label(row.yKey)}: {row.y.map((v, i) => `y(${fmtNum(m.at[i])})=${v === null ? "—" : withUnit(v, active?.data.units[row.yKey] ?? "")}`).join(" | ")}
          </span>
        ))}
      {hidden && m?.mode === mode && <span className="lbl">markers hidden: {hidden}</span>}
      {mode !== "interpolate" && (
        <>
          <Button size="sm" disabled={!found} title={found ? "Add the measured positions as a worksheet" : "Nothing measured to add"} onClick={() => { if (m && m.mode !== "interpolate") void commit(m); }}>
            Commit
          </Button>
          <Button size="sm" disabled={!found || reporting} onClick={() => { if (active && m && m.mode !== "interpolate") void report(active, m); }}>
            {reporting ? "Reporting…" : "→ Report"}
          </Button>
        </>
      )}
    </>
  );
}
