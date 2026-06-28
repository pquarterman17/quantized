// Inspector control for the 2-D map: the gridding (scattered-data interpolation)
// method + grid resolution. Store-backed so the MapStage canvas re-grids live.
// Rendered only on the Map tab (gated by the Inspector).

import { useApp } from "../../store/useApp";
import { Card, Select } from "../primitives";

const METHODS = [
  { value: "natural", label: "natural (Sibson)" },
  { value: "linear", label: "linear" },
  { value: "nearest", label: "nearest" },
  { value: "idw", label: "inverse-distance" },
];
const RESOLUTIONS = [100, 200, 400].map((n) => ({ value: String(n), label: `${n} × ${n}` }));

export default function MapCard() {
  const method = useApp((s) => s.mapMethod);
  const res = useApp((s) => s.mapRes);
  const setMapMethod = useApp((s) => s.setMapMethod);
  const setMapRes = useApp((s) => s.setMapRes);

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
    </Card>
  );
}
