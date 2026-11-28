// Curve measurements — the controls: which curve(s), then the settings of the
// chosen measurement. Logic lives in useCurveMeasure.

import { Button, Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { pickOptions } from "../analysisextras/columnPicks";
import type { CurveMeasureState } from "./useCurveMeasure";

const GRID = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 } as const;
const ROW = { display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" } as const;

export const MODE_OPTIONS = [
  { value: "intersect", label: "Intersection of two curves" },
  { value: "level", label: "Level crossings" },
  { value: "step", label: "Rise / fall time" },
];

export default function CurveMeasureControls({ g }: { g: CurveMeasureState }) {
  const s = g.settings;
  const opts = pickOptions(g.columns);
  const unit = (u: string) => (u ? ` (${u})` : "");
  return (
    <>
      <div style={{ marginTop: 8 }}>
        <label className="qzk-field-lbl">Measure</label>
        <Select aria-label="Measurement" options={MODE_OPTIONS} value={s.mode} onChange={(e) => g.set("mode", e.target.value as typeof s.mode)} />
      </div>
      <div style={GRID}>
        <div>
          <label className="qzk-field-lbl">{s.mode === "intersect" ? "Curve A, X" : "X"}</label>
          <Select aria-label="X column" options={opts} value={String(g.xCol)} onChange={(e) => g.setXCol(Number(e.target.value))} />
        </div>
        <div>
          <label className="qzk-field-lbl">{s.mode === "intersect" ? "Curve A, Y" : "Y"}</label>
          <Select aria-label="Y column" options={opts} value={String(g.yCol)} onChange={(e) => g.setYCol(Number(e.target.value))} />
        </div>
      </div>

      {s.mode === "intersect" && (
        <>
          <div style={{ marginTop: 8 }}>
            <label className="qzk-field-lbl">Curve B worksheet</label>
            <Select
              aria-label="Curve B worksheet"
              options={[{ value: "", label: "Same worksheet" }, ...g.bDatasets.map((d) => ({ value: d.id, label: d.name }))]}
              value={g.bId}
              onChange={(e) => g.setBId(e.target.value)}
            />
          </div>
          <div style={GRID}>
            <div>
              <label className="qzk-field-lbl">Curve B, X</label>
              <Select aria-label="Curve B X column" options={pickOptions(g.bColumns)} value={String(g.bX)} onChange={(e) => g.setBX(Number(e.target.value))} />
            </div>
            <div>
              <label className="qzk-field-lbl">Curve B, Y</label>
              <Select aria-label="Curve B Y column" options={pickOptions(g.bColumns)} value={String(g.bY)} onChange={(e) => g.setBY(Number(e.target.value))} />
            </div>
          </div>
          <div className="qzk-helptext" style={{ marginTop: 6 }}>
            Both curves are read as drawn (straight lines between points) and compared where their X ranges overlap.
          </div>
        </>
      )}

      {s.mode === "level" && (
        <>
          <div style={ROW}>
            <div>
              <label className="qzk-field-lbl">Y level{unit(g.yUnit)}</label>
              <NumberField aria-label="Y level" value={s.level} width={84} onChange={(v) => g.set("level", v)} />
            </div>
            <div>
              <label className="qzk-field-lbl">Dead band ±{unit(g.yUnit)}</label>
              <NumberField aria-label="Dead band" value={s.hysteresis} width={84} placeholder="0" onChange={(v) => g.set("hysteresis", v)} />
            </div>
            <div>
              <label className="qzk-field-lbl">Direction</label>
              <Select
                aria-label="Crossing direction"
                options={[{ value: "both", label: "Both" }, { value: "rising", label: "Rising" }, { value: "falling", label: "Falling" }]}
                value={s.direction}
                onChange={(e) => g.set("direction", e.target.value as typeof s.direction)}
              />
            </div>
          </div>
          <div className="qzk-helptext" style={{ marginTop: 6 }}>
            With a dead band the curve counts as above the level only once it is more than that far over it, and below only once it is that far under, so noise near the level gives one crossing, not a burst.
          </div>
        </>
      )}

      {s.mode === "step" && (
        <>
          <div style={ROW}>
            <div>
              <label className="qzk-field-lbl">From (%)</label>
              <NumberField aria-label="Low percentage" value={s.lowPct} width={60} onChange={(v) => g.set("lowPct", v)} />
            </div>
            <div>
              <label className="qzk-field-lbl">to (%)</label>
              <NumberField aria-label="High percentage" value={s.highPct} width={60} onChange={(v) => g.set("highPct", v)} />
            </div>
            <div>
              <label className="qzk-field-lbl">Edge</label>
              <Select
                aria-label="Edge"
                options={[{ value: "auto", label: "First edge" }, { value: "rise", label: "Rise" }, { value: "fall", label: "Fall" }]}
                value={s.edge}
                onChange={(e) => g.set("edge", e.target.value as typeof s.edge)}
              />
            </div>
          </div>
          <div style={ROW}>
            <div>
              <label className="qzk-field-lbl">Low level{unit(g.yUnit)}</label>
              <NumberField aria-label="Low level" value={s.lowLevel} width={84} placeholder="auto" onChange={(v) => g.set("lowLevel", v)} />
            </div>
            <div>
              <label className="qzk-field-lbl">High level{unit(g.yUnit)}</label>
              <NumberField aria-label="High level" value={s.highLevel} width={84} placeholder="auto" onChange={(v) => g.set("highLevel", v)} />
            </div>
          </div>
          {s.plateauMethod === "band" && (
            <div className="qzk-helptext" role="note" style={{ marginTop: 6 }}>
              Plateaus: band estimate, saved before state levels. Its numbers are kept as saved.{" "}
              <Button size="sm" disabled={g.busy} onClick={g.remeasure}>Re-measure with state levels</Button>
            </div>
          )}
          <div className="qzk-helptext" style={{ marginTop: 6 }}>
            Left empty, the low (base) and high (top) levels are the IEEE Std 181-2011 histogram state levels: the fullest bin of the lower and of the upper half of a 100-bin histogram of Y (the median of that bin&apos;s samples), so noise, spikes and the edge itself do not move them. A trace with no clear two-level shape (a ramp, a pure exponential, an oscillation) is refused with a reason rather than guessed; type the level to measure it anyway. The two percentages (10 / 90 %, or 20 / 80 %) are fractions of the step height above the low level.
          </div>
        </>
      )}
    </>
  );
}
