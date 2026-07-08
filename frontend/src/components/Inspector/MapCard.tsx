// Inspector control for the 2-D map: the gridding (scattered-data interpolation)
// method + grid resolution, plus the interactive contour overlay controls
// (ORIGIN_GAP_PLAN #17 remaining half). Store-backed so the MapStage canvas
// re-grids / re-contours live. Rendered only on the Map tab (gated by the
// Inspector).

import { useApp } from "../../store/useApp";
import { Card, Select } from "../primitives";

const METHODS = [
  { value: "natural", label: "natural (Sibson)" },
  { value: "linear", label: "linear" },
  { value: "nearest", label: "nearest" },
  { value: "idw", label: "inverse-distance" },
];
const RESOLUTIONS = [100, 200, 400].map((n) => ({ value: String(n), label: `${n} × ${n}` }));
const LEVEL_COUNTS = [4, 6, 8, 12, 16, 20].map((n) => ({ value: String(n), label: String(n) }));
const SCALES = [
  { value: "linear", label: "linear" },
  { value: "log", label: "log" },
];

export default function MapCard() {
  const method = useApp((s) => s.mapMethod);
  const res = useApp((s) => s.mapRes);
  const setMapMethod = useApp((s) => s.setMapMethod);
  const setMapRes = useApp((s) => s.setMapRes);
  const contourOn = useApp((s) => s.contourOn);
  const levelCount = useApp((s) => s.contourLevelCount);
  const scale = useApp((s) => s.contourScale);
  const setContourOn = useApp((s) => s.setContourOn);
  const setContourLevelCount = useApp((s) => s.setContourLevelCount);
  const setContourScale = useApp((s) => s.setContourScale);

  return (
    <Card title="2-D map" defaultOpen={true}>
      <label className="qzk-field-lbl">Grid method</label>
      <Select options={METHODS} value={method} onChange={(e) => setMapMethod(e.target.value)} />
      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        Resolution
      </label>
      <Select
        options={RESOLUTIONS}
        value={String(res)}
        onChange={(e) => setMapRes(Number(e.target.value))}
      />

      <label className="qzk-field-lbl" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={contourOn} onChange={(e) => setContourOn(e.target.checked)} />
        Contour lines
      </label>
      {contourOn && (
        <>
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Levels
          </label>
          <Select
            options={LEVEL_COUNTS}
            value={String(levelCount)}
            onChange={(e) => setContourLevelCount(Number(e.target.value))}
          />
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Spacing
          </label>
          <Select
            options={SCALES}
            value={scale}
            onChange={(e) => setContourScale(e.target.value as "linear" | "log")}
          />
        </>
      )}
    </Card>
  );
}
