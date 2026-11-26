// Inspector control for the 2-D map: the gridding (scattered-data interpolation)
// method + grid resolution, plus the interactive contour overlay controls
// (ORIGIN_GAP_PLAN #17 remaining half). Store-backed so the MapStage canvas
// re-grids / re-contours live. Rendered only on the Map tab (gated by the
// Inspector).

import { Suspense, lazy } from "react";

import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import Card from "../primitives/Card";
import MapCellLabels from "./MapCellLabels";
import MapColorLimits from "./MapColorLimits";

// Only the Shepard / kriging methods have options; their fields load on demand.
const MapGridOptions = lazy(() => import("./MapGridOptions"));

const METHODS = [
  { value: "natural", label: "natural (Sibson)" },
  { value: "linear", label: "linear" },
  { value: "nearest", label: "nearest" },
  { value: "idw", label: "inverse-distance" },
  { value: "renka", label: "Renka-Cline (C1 cubic)" },
  { value: "shepard", label: "modified Shepard" },
  { value: "kriging", label: "kriging" },
];
const RESOLUTIONS = [100, 200, 400].map((n) => ({ value: String(n), label: `${n} × ${n}` }));
const LEVEL_COUNTS = [4, 6, 8, 12, 16, 20].map((n) => ({ value: String(n), label: String(n) }));
const SCALES = [
  { value: "linear", label: "linear" },
  { value: "log", label: "log" },
];

/** `datasetId` + `name`: the map window's dataset the colour limits edit, shown in the title (the window
 *  layout's card, components/workshops/windowlayout/MapStyleCard). Omitted: the active dataset (classic). */
export default function MapCard({ datasetId, name }: { datasetId?: string; name?: string } = {}) {
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
    <Card title={name === undefined ? "2-D map" : `2-D map: ${name}`} cardId="2-D map" defaultOpen={true}>
      <label className="qzk-field-lbl">Grid method</label>
      <Select aria-label="Grid method" options={METHODS} value={method} onChange={(e) => setMapMethod(e.target.value)} />
      {(method === "shepard" || method === "kriging") && (
        <Suspense fallback={null}>
          <MapGridOptions method={method} />
        </Suspense>
      )}
      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        Resolution
      </label>
      <Select
        aria-label="Grid resolution"
        options={RESOLUTIONS}
        value={String(res)}
        onChange={(e) => setMapRes(Number(e.target.value))}
      />

      {/* Audit P2.8 — the map's explicit z (colour) limits for the ACTIVE
          dataset, beside the grid controls (two typed fields, the same shape
          as the Axes card's own X/Y Limits row). Since review round 7 the
          float toolbar ALSO carries this control, per window
          (components/Stage/MapToolbarColorLimits.tsx) — this row is not
          redundant with it: the toolbar control edits whatever dataset that
          ONE window is bound to, while this row always edits the active
          dataset, which is what lets it sit in the Inspector at all. */}
      <MapColorLimits datasetId={datasetId} />
      <MapCellLabels datasetId={datasetId} />

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
            aria-label="Contour levels"
            options={LEVEL_COUNTS}
            value={String(levelCount)}
            onChange={(e) => setContourLevelCount(Number(e.target.value))}
          />
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Spacing
          </label>
          <Select
            aria-label="Contour spacing"
            options={SCALES}
            value={scale}
            onChange={(e) => setContourScale(e.target.value as "linear" | "log")}
          />
        </>
      )}
    </Card>
  );
}
