// Box card — the numeric-only Cartesian box cut (RSM_CUTS_PLAN item 8). A
// drawn box (item 6, not built here) and a typed one are the SAME
// `store.mapRoi` field, so this card works whether or not anything has ever
// been drawn on the map: editing any bound field creates the box (full data
// extent, then the edited field) the first time. This is NEVER required for
// a plain box cut once item 6 lands — that inline commit bar is the fast
// path; this card is the one place a box cut works without touching the
// canvas at all (repeat-across-datasets, exact numeric bounds).

import Card from "../../primitives/Card";
import { Button, Select, SegmentedControl } from "../../primitives";
import type { CutSpace } from "../../../lib/mapcuts";
import type { RoiCutsState } from "./useRoiCuts";
import Field from "./Field";

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  return Number(v.toPrecision(5)).toString();
}

export default function BoxCard({ roi }: { roi: RoiCutsState }) {
  const rect = roi.boxRect;
  const disabled = !roi.isMap || !rect;

  return (
    <Card title="Box">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          Space
        </span>
        <SegmentedControl<CutSpace>
          options={[
            { value: "angular", label: "2θ/ω" },
            { value: "q", label: "Q" },
          ]}
          value={roi.boxSpace}
          onChange={roi.setBoxSpace}
        />
        {!roi.qAvailable && <span className="qzk-ds-meta">no Qx/Qz on this dataset</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <Field label="x min" value={rect?.x0 ?? 0} onChange={roi.setBoxX0} disabled={!roi.isMap} />
        <Field label="x max" value={rect?.x1 ?? 0} onChange={roi.setBoxX1} disabled={!roi.isMap} />
        <Field label="y min" value={rect?.y0 ?? 0} onChange={roi.setBoxY0} disabled={!roi.isMap} />
        <Field label="y max" value={rect?.y1 ?? 0} onChange={roi.setBoxY1} disabled={!roi.isMap} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          Collapse
        </span>
        <SegmentedControl<"x" | "y">
          options={[
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
          ]}
          value={roi.boxCollapse}
          onChange={roi.setBoxCollapse}
        />
        <Select
          value={roi.boxReduce}
          onChange={(e) => roi.setBoxReduce(e.target.value as "sum" | "mean" | "max")}
          options={[
            { value: "sum", label: "sum" },
            { value: "mean", label: "mean" },
            { value: "max", label: "max" },
          ]}
        />
        <Field label="bins" value={roi.boxBins} onChange={roi.setBoxBins} width={56} title="Bin count for the mask+bin (Q / rotated / wrapped) path" />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button variant="primary" size="sm" disabled={disabled || roi.busy} onClick={() => roi.runBox()}>
          {roi.busy ? "Working…" : "Run"}
        </Button>
        <Button size="sm" disabled={disabled || roi.statsBusy} onClick={() => void roi.runStats()}>
          {roi.statsBusy ? "Working…" : "Stats"}
        </Button>
      </div>

      {roi.boxStats && (
        <div
          className="qzk-ds-meta"
          style={{ marginTop: 10, display: "grid", gridTemplateColumns: "auto auto", gap: "3px 16px", userSelect: "text" }}
        >
          <span>∫I</span>
          <strong>{fmt(roi.boxStats.integrated_intensity)}</strong>
          <span>centroid (x, y)</span>
          <strong>
            {fmt(roi.boxStats.centroid_x)}, {fmt(roi.boxStats.centroid_y)}
          </strong>
          <span>peak (x, y)</span>
          <strong>
            {fmt(roi.boxStats.peak_x)}, {fmt(roi.boxStats.peak_y)}
          </strong>
          <span>N</span>
          <strong>{roi.boxStats.n_points}</strong>
        </div>
      )}
      {roi.statsError && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--danger)" }}>
          {roi.statsError}
        </div>
      )}
    </Card>
  );
}
