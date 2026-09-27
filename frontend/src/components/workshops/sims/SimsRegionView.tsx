// SIMS workshop, Region tab — view (audit P2.3, box 4). Pick a profile and a
// depth region; each species' dose, peak, mean and junction depth are
// measured live, with every rule stated, then exported as CSV or added to
// Reports. Thin — the logic lives in useSimsRegion, the formulas in
// calc.sims_region.

import TransformWarningList from "../../overlays/TransformWarningList";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";
import type { TransformWarning } from "../../../lib/transformWarnings";
import { useSimsRegion, type SimsRegionState, type ThresholdMode } from "./useSimsRegion";

const gap = { marginTop: 8 };
const row = { display: "flex", gap: 6, alignItems: "center", marginTop: 4 } as const;
const faint = { color: "var(--text-faint)" } as const;
const mono = { fontFamily: "var(--font-mono)" } as const;

/** A number for the table: 4 significant digits, exponent form when large/small. */
export function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(3) : String(Number(v.toPrecision(4)));
}

function Results({ r }: { r: SimsRegionState }) {
  if (r.formError) return <div className="qzk-ds-meta" style={{ ...gap, ...faint }}>{r.formError}</div>;
  if (r.loading) return <div className="qzk-ds-meta" style={gap} aria-live="polite">Measuring…</div>;
  if (r.previewError) {
    return <div className="qzk-ds-meta" role="alert" style={{ ...gap, color: "var(--danger)" }}>{r.previewError}</div>;
  }
  const res = r.result;
  if (!res) return null;
  const du = res.x_unit ? ` ${res.x_unit}` : "";
  const cell = (v: number | null | undefined, unit = "") => (
    <span style={mono}>{fmtNum(v)}{v != null && unit ? <span style={faint}>{unit}</span> : null}</span>
  );
  return (
    <div style={gap} role="group" aria-label="Region measures">
      <div style={{ overflowX: "auto" }}>
        <DataTable
          columns={["Species", "Integral", "Peak", `at${du}`, "Mean", `Junction${du}`]}
          rows={res.species.map((s) => [
            s.name,
            <span key="i" title={s.integral_kind === "raw" ? "raw integral: not an areal dose" : "areal dose"}>
              {cell(s.integral, ` ${s.integral_unit}`)}
            </span>,
            cell(s.peak),
            cell(s.peak_depth),
            cell(s.mean),
            <span key="j" title={s.crossings.map((c) => `${fmtNum(c.depth)} ${c.direction}`).join("; ")}>
              {cell(s.junction_depth)}
              {s.junction_direction ? <span style={faint}> {s.junction_direction === "falling" ? "↓" : "↑"}</span> : null}
            </span>,
          ])}
        />
      </div>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
        {res.rows_in_region} rows in {res.x_name} {fmtNum(res.region[0])} … {fmtNum(res.region[1])}{du} (inclusive).
        Integral: trapezoid over the samples inside the region, not extrapolated to its edges; an areal dose only when
        the values are a volume concentration and x is a depth. Mean: point average. Junction: first threshold crossing,
        interpolated between samples.
      </div>
      <TransformWarningList warnings={res.warnings as TransformWarning[]} />
      <div style={{ ...row, marginTop: 10 }}>
        <Button size="sm" onClick={r.exportCsv}>Export CSV</Button>
        <Button size="sm" disabled={r.busy} onClick={() => void r.addToReports()}>
          {r.busy ? "Adding…" : "Add to Reports"}
        </Button>
      </div>
    </div>
  );
}

export default function SimsRegionView() {
  const r = useSimsRegion();
  const f = r.form;
  return (
    <div>
      <label className="qzk-field-lbl">Profile</label>
      <Select
        aria-label="Region profile"
        options={r.datasets.map((d) => ({ value: d.id, label: d.name }))}
        value={r.datasetId}
        onChange={(e) => r.setDatasetId(e.target.value)}
      />
      <label className="qzk-field-lbl" style={gap}>Region ({r.xName})</label>
      <div style={row}>
        <NumberField aria-label="Region from" value={f.lo} onChange={(v) => r.setForm({ lo: v })} width={80} />
        <span className="qzk-ds-meta">to</span>
        <NumberField aria-label="Region to" value={f.hi} onChange={(v) => r.setForm({ hi: v })} width={80} unit={r.xUnit || undefined} />
      </div>
      <label className="qzk-field-lbl" style={gap}>Species</label>
      <div role="group" aria-label="Region species" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.labels.map((l) => (
          <Checkbox
            key={l}
            checked={f.species.includes(l)}
            onChange={(on) => r.setForm({ species: on ? [...f.species, l] : f.species.filter((s) => s !== l) })}
          >
            {l}
          </Checkbox>
        ))}
      </div>
      <label className="qzk-field-lbl" style={gap}>Junction threshold</label>
      <div style={row}>
        <Select
          aria-label="Threshold mode"
          options={[
            { value: "fraction", label: "% of each species' peak" },
            { value: "absolute", label: "absolute value" },
          ]}
          value={f.mode}
          onChange={(e) => r.setForm({ mode: e.target.value as ThresholdMode, threshold: e.target.value === "fraction" ? "50" : "" })}
        />
        <NumberField aria-label="Threshold" value={f.threshold} onChange={(v) => r.setForm({ threshold: v })} width={80} unit={f.mode === "fraction" ? "%" : undefined} />
      </div>
      <Results r={r} />
    </div>
  );
}
