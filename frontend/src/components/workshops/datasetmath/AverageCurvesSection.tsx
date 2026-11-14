// Dataset Math — "Average N datasets" view (origin gap audit 2 #9, Origin's
// "Average Multiple Curves"). Thin: state and the commit live in
// useCurveAverage. The result is a new linked dataset with mean, SD, SEM and
// N columns; SEM is bound as the mean's error bars.

import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { useCurveAverage } from "./useCurveAverage";

export default function AverageCurvesSection() {
  const m = useCurveAverage();
  return (
    <>
      <label className="qzk-field-lbl">Datasets to average ({m.picked.length})</label>
      <div
        role="group"
        aria-label="Datasets to average"
        style={{ maxHeight: 140, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}
      >
        {m.datasets.map((d) => (
          <div key={d.id}>
            <Checkbox checked={m.picked.includes(d.id)} onChange={() => m.toggle(d.id)}>
              {d.name}
            </Checkbox>
          </div>
        ))}
      </div>

      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        Y column
      </label>
      <Select
        aria-label="Y column to average"
        options={[
          { value: "", label: "First column of each" },
          ...m.sharedColumns.map((c) => ({ value: c, label: c })),
        ]}
        value={m.channel}
        onChange={(e) => m.setChannel(e.target.value)}
      />

      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        Common x grid (linear interpolation)
      </label>
      <SegmentedControl
        aria-label="Common x grid"
        options={[
          { value: "union", label: "Union of x" },
          { value: "step", label: "Step over overlap" },
        ]}
        value={m.grid}
        onChange={m.setGrid}
      />
      {m.grid === "step" && (
        <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
          <span className="qzk-ds-meta">Step</span>
          <NumberField aria-label="Grid step" value={m.step} onChange={m.setStep} width={90} />
        </div>
      )}
      <div className="qzk-ds-meta qzk-msg" style={{ marginTop: 4, color: "var(--text-faint)" }}>
        {m.grid === "union"
          ? "Every x of every curve; outside a curve's range it is left out (never extrapolated), and N counts the curves averaged."
          : "Only the x-range all curves share, so every point averages all of them."}
      </div>

      <div style={{ marginTop: 6 }}>
        <Checkbox checked={m.sortUnsorted} onChange={m.setSortUnsorted} title="A loop's up and down sweeps are merged when sorted">
          Sort x that reverses direction
        </Checkbox>
      </div>
      {(m.unitRefused || m.allowUnits) && (
        <div style={{ marginTop: 4 }}>
          <Checkbox checked={m.allowUnits} onChange={m.setAllowUnits}>
            Average despite the unit mismatch
          </Checkbox>
        </div>
      )}

      <Button
        variant="primary"
        size="sm"
        disabled={m.busy || m.blocked !== null}
        onClick={() => void m.compute()}
        style={{ marginTop: 12, width: "100%" }}
      >
        {m.busy ? "Averaging…" : "Average → new dataset (mean, SD, SEM, N)"}
      </Button>
      {m.blocked && (
        <div className="qzk-ds-meta qzk-msg" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          {m.blocked}
        </div>
      )}
      {m.error && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ marginTop: 8, color: "var(--danger)" }}>
          {m.error}
        </div>
      )}
    </>
  );
}
