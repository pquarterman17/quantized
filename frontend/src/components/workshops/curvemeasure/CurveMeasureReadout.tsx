// Curve measurements — the readout: values with the dataset's units.

import { DataTable } from "../../primitives/DataTable";
import { fmtNum as fmt } from "../../../lib/format";
import type { CurveMeasureState } from "./useCurveMeasure";

const pct = (f: number): number => Math.round(f * 100);

export default function CurveMeasureReadout({ g }: { g: CurveMeasureState }) {
  const m = g.result;
  if (!m) return null;
  const xu = g.xUnit ? ` ${g.xUnit}` : "";
  const yu = g.yUnit ? ` ${g.yUnit}` : "";
  const xHead = g.xUnit ? `X (${g.xUnit})` : "X";
  const yHead = g.yUnit ? `Y (${g.yUnit})` : "Y";
  const merged = (n: number) => (n > 0 ? <div className="qzk-ds-meta" style={{ marginTop: 6 }}>{n} repeated X value(s) were averaged.</div> : null);
  if (m.mode === "intersect") {
    const rows = m.r.intersections;
    return (
      <div style={{ marginTop: 12 }} aria-label="Intersections">
        <div style={{ fontFamily: "var(--font-mono)" }}>
          {rows.length === 0 ? "The curves do not meet in the overlapping range" : `${rows.length} intersection${rows.length === 1 ? "" : "s"}`}
          {` (X ${fmt(m.r.x_min)} to ${fmt(m.r.x_max)}${xu})`}
        </div>
        {rows.length > 0 && (
          <DataTable
            columns={["#", xHead, yHead, "kind"]}
            rows={rows.map((p, i) => [
              String(i + 1), fmt(p.x), fmt(p.y),
              p.kind === "coincident" ? `coincident to ${fmt(p.x_end)}` : p.kind === "touch" ? "touch" : `A crosses B, ${p.direction}`,
            ])}
          />
        )}
        {merged(m.r.merged_a + m.r.merged_b)}
      </div>
    );
  }
  if (m.mode === "level") {
    const rows = m.r.crossings;
    return (
      <div style={{ marginTop: 12 }} aria-label="Level crossings">
        <div style={{ fontFamily: "var(--font-mono)" }}>
          {rows.length === 0 ? `The curve never crosses ${fmt(m.r.level)}${yu}` : `${rows.length} crossing${rows.length === 1 ? "" : "s"} of ${fmt(m.r.level)}${yu}`}
        </div>
        {rows.length > 0 && (
          <DataTable columns={["#", xHead, "direction"]} rows={rows.map((c, i) => [String(i + 1), fmt(c.x), c.direction])} />
        )}
        {merged(m.r.merged_duplicates)}
      </div>
    );
  }
  const r = m.r;
  const lo = pct(r.low_fraction);
  const hi = pct(r.high_fraction);
  return (
    <div style={{ marginTop: 12 }} aria-label="Step time">
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg, 15px)" }}>
        {r.edge === "rise" ? "Rise" : "Fall"} time ({lo} to {hi} %) = {fmt(r.time)}{xu}
      </div>
      <DataTable
        columns={["stat", "value"]}
        rows={[
          [`X at ${lo} %`, `${fmt(r.x_low)}${xu}`],
          [`X at ${hi} %`, `${fmt(r.x_high)}${xu}`],
          [`level at ${lo} %`, `${fmt(r.low_level)}${yu}`],
          [`level at ${hi} %`, `${fmt(r.high_level)}${yu}`],
          [`low plateau${r.plateaus_estimated[0] ? " (state level)" : " (given)"}`, `${fmt(r.low_plateau)}${yu}`],
          [`high plateau${r.plateaus_estimated[1] ? " (state level)" : " (given)"}`, `${fmt(r.high_plateau)}${yu}`],
        ]}
      />
      {merged(r.merged_duplicates)}
    </div>
  );
}
