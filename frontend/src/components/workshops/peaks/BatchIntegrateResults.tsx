// Batch integrate — the dataset x window result table, its CSV export, and
// the trend dataset (integrated intensity vs a metadata field) for the library.

import { fmtNum } from "../../../lib/format";
import { pathId } from "../../../lib/metadataKeys";
import { toast } from "../../../store/toasts";
import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import type { BatchIntegrateState } from "./useBatchIntegrate";

const cell = (v: number | null) => (v === null ? "—" : fmtNum(v));

export default function BatchIntegrateResults({ b }: { b: BatchIntegrateState }) {
  if (!b.rows) return null;
  const rows = b.rows.map((r) => [
    r.dataset,
    `${r.window} (${fmtNum(r.lo)}–${fmtNum(r.hi)})`,
    cell(r.area),
    cell(r.centroid),
    cell(r.fwhm),
    cell(r.height),
    r.status === "ok" ? "ok" : <span title={r.error ?? undefined} style={{ color: "var(--danger)" }}>{r.error}</span>,
  ]);

  const addTrend = () => {
    const out = b.addTrend();
    if (!out) return;
    const skipped = out.skipped.length ? ` (${out.skipped.length} skipped: ${out.skipped.join("; ")})` : "";
    if (!out.id) toast(`no dataset could be added to the trend${skipped}`, "danger");
    else toast(`trend added to the library${skipped}`, out.skipped.length ? "info" : undefined);
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div role="region" aria-label="batch integration results" style={{ maxHeight: 240, overflow: "auto" }}>
        <DataTable columns={["dataset", "window", "area", "centroid", "FWHM", "height", "status"]} rows={rows} />
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <Button size="sm" onClick={b.exportCsv}>Export CSV</Button>
        <span className="qzk-field-lbl" style={{ margin: 0, marginLeft: "auto" }}>Trend x</span>
        <Select
          aria-label="trend x field"
          options={[{ value: "", label: "Dataset order" }, ...b.fields.map((f) => ({ value: pathId(f.path), label: f.label }))]}
          value={b.xField}
          onChange={(e) => b.setXField(e.target.value)}
        />
        <Button size="sm" title="One row per dataset: area, centroid and FWHM of each window." onClick={addTrend}>
          Add trend dataset
        </Button>
      </div>
    </div>
  );
}
