// Sector card — annulus/azimuth profiles, routed per the polar-space rule
// (RSM_CUTS_PLAN item 8, Resolved decisions): "Radial profile" and
// "Azimuthal profile" hit true-polar `/sector`+`/chi-profile` when the
// active dataset carries Qx/Qz, silently-to-the-user-but-not-silently-
// disabled become a periodic BOX cut when a pole-figure φ/ψ axis pair is
// detected instead (`useRoiCuts`'s `polarBranch`), and are disabled with the
// reason visible as a tooltip (and inline text) when neither applies — a
// disabled control with no explanation is exactly what this rule forbids.

import Card from "../../primitives/Card";
import { Button, Select, SegmentedControl } from "../../primitives";
import type { RoiCutsState } from "./useRoiCuts";
import Field from "./Field";

export default function SectorCard({ roi }: { roi: RoiCutsState }) {
  const disabled = !roi.isMap;
  const secLabel = roi.polar.kind === "q" ? "q" : "secondary axis";
  const canProfile = roi.isMap && roi.polar.kind !== "none";
  const reason = roi.polar.kind === "none" ? roi.polar.reason : undefined;

  return (
    <Card title="Sector">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          φ as
        </span>
        <SegmentedControl<"center" | "bounds">
          options={[
            { value: "center", label: "centre ± Δ" },
            { value: "bounds", label: "min / max" },
          ]}
          value={roi.phiParam}
          onChange={roi.setPhiParam}
        />
      </div>

      {roi.phiParam === "center" ? (
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="φ centre" value={roi.phiCenter} onChange={roi.setPhiCenter} disabled={disabled} />
          <Field label="± Δ" value={roi.phiHalfWidth} onChange={roi.setPhiHalfWidth} disabled={disabled} />
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="φ min" value={roi.phiMin} onChange={roi.setPhiMin} disabled={disabled} />
          <Field label="φ max" value={roi.phiMax} onChange={roi.setPhiMax} disabled={disabled} />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <Field label={`${secLabel} min`} value={roi.secMin} onChange={roi.setSecMin} disabled={disabled} />
        <Field label={`${secLabel} max`} value={roi.secMax} onChange={roi.setSecMax} disabled={disabled} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <Field label="bins" value={roi.sectorBins} onChange={roi.setSectorBins} width={56} disabled={disabled} />
        <Select
          value={roi.sectorMode}
          onChange={(e) => roi.setSectorMode(e.target.value as "sum" | "mean")}
          options={[
            { value: "sum", label: "sum" },
            { value: "mean", label: "mean" },
          ]}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={!canProfile || roi.busy}
          title={reason}
          onClick={roi.runSector}
        >
          {roi.busy ? "Working…" : "Radial profile"}
        </Button>
        <Button size="sm" disabled={!canProfile || roi.busy} title={reason} onClick={roi.runChi}>
          Azimuthal profile
        </Button>
      </div>

      {roi.isMap && roi.polar.kind === "pole" && (
        <div className="qzk-ds-meta" style={{ marginTop: 8 }}>
          No Qx/Qz on this dataset — using a periodic box integration on its φ/ψ axis pair
          (φ = {roi.polar.axis === "x" ? "x" : "y"}-axis) instead of true polar.
        </div>
      )}
      {roi.isMap && roi.polar.kind === "none" && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {roi.polar.reason}
        </div>
      )}
    </Card>
  );
}
