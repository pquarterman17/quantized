// Polar map Stage (GAP_AUDIT_9 G2): heatmap and/or contour of intensity
// I(chi, phi) on a polar disk, chi = tilt from the centre, phi = azimuth --
// a pole figure when the data are texture scans. Shown by PolarStage when the
// "Polar map" plot type is active (lib/polarMapMode.ts).
//
// The picture is the server's own render of the exact request Export sends
// (calc/figure_polar_map.py), so screen == export. Projection default is
// equal-area (Schmidt): OWNER DECISION 2026-11-24 (GAP_AUDIT_9 D4);
// stereographic (Wulff) is offered. Lives with its logic in workshops/polarmap/ (the ternary lazy-mount guard).

import AuxFigureFrame from "../ternary/AuxFigureFrame";
import { usePolarMap } from "./usePolarMap";
import type { PolarMapCmap, PolarMapKind, PolarProjection } from "./polarMapRequest";
import { Select } from "../../primitives";
import { useAuxFigureMenu } from "../plots2/useAuxFigureMenu";

const PROJECTIONS = [
  { value: "equal_area", label: "Equal-area (Schmidt)" },
  { value: "stereographic", label: "Stereographic (Wulff)" },
];
const KINDS = [
  { value: "heatmap", label: "Heatmap" },
  { value: "contour", label: "Contour" },
  { value: "both", label: "Heatmap + contour" },
];
const CMAPS = ["viridis", "magma", "gray", "rdbu"].map((v) => ({ value: v, label: v }));

export default function PolarMapStage() {
  const m = usePolarMap();
  const { picks } = m;
  const menu = useAuxFigureMenu({ problem: m.problem, onExport: () => void m.exportNow() });
  if (!m.hasData || !picks) {
    return (
      <div className="qzk-helptext" style={{ padding: 16, color: "var(--text-faint)" }}>
        Select a dataset with tilt, azimuth and intensity columns.
      </div>
    );
  }
  const cols = m.columns.map((c) => ({ value: String(c.index), label: c.label || "X" }));
  const pick = (label: string, key: "chi" | "phi" | "z", title: string) => (
    <div style={{ minWidth: 110 }}>
      <label className="qzk-field-lbl">{title}</label>
      <Select aria-label={label} options={cols} value={String(picks[key])} onChange={(e) => m.setPick({ [key]: Number(e.target.value) })} />
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "52px 12px 12px" }} onContextMenu={menu.onContextMenu}>
      {menu.node}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {pick("Tilt column", "chi", "Tilt χ (0-90°)")}
        {pick("Azimuth column", "phi", "Azimuth φ")}
        {pick("Intensity column", "z", "Intensity")}
        <div>
          <label className="qzk-field-lbl">Projection</label>
          <Select aria-label="Projection" options={PROJECTIONS} value={picks.projection} onChange={(e) => m.setPick({ projection: e.target.value as PolarProjection })} />
        </div>
        <div>
          <label className="qzk-field-lbl">Draw</label>
          <Select aria-label="Draw" options={KINDS} value={picks.mode} onChange={(e) => m.setPick({ mode: e.target.value as PolarMapKind })} />
        </div>
        <div>
          <label className="qzk-field-lbl">Colormap</label>
          <Select aria-label="Colormap" options={CMAPS} value={picks.cmap} onChange={(e) => m.setPick({ cmap: e.target.value as PolarMapCmap })} />
        </div>
        <label className="qzk-field-lbl" style={{ alignSelf: "flex-end" }}>
          <input type="checkbox" checked={picks.logZ} onChange={(e) => m.setPick({ logZ: e.target.checked })} /> log intensity
        </label>
      </div>
      <AuxFigureFrame
        title={m.title}
        setTitle={m.setTitle}
        fmt={m.fmt}
        setFmt={m.setFmt}
        onExport={() => void m.exportNow()}
        notice={m.notice}
        problem={m.problem}
        preview={m.preview}
        alt="Polar map preview"
      />
    </div>
  );
}
