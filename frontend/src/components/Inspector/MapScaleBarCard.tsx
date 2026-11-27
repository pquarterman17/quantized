// Inspector control: a scale bar on the 2-D map (`MapViewState.scaleBar`,
// lib/mapScaleBar.ts), in the map's X data units. Length (blank = a round
// number near 20 % of the axis), label (blank = the length with the axis unit),
// corner and colour. The canvas draws it and the vector export draws the same
// bar. Loaded on demand with the card it sits in.
import { DEFAULT_SCALE_BAR, SCALE_BAR_CORNERS, type ScaleBarCorner } from "../../lib/mapScaleBarOptions";
import { mapViewFor } from "../../lib/mapView";
import { setMapScaleBar } from "../../store/mapScaleBarEdit";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import BufferedNumberField from "../primitives/BufferedNumberField";

const CORNERS: Record<ScaleBarCorner, string> = {
  bl: "bottom left", br: "bottom right", tl: "top left", tr: "top right",
};
const CORNER_OPTIONS = SCALE_BAR_CORNERS.map((c) => ({ value: c, label: CORNERS[c] }));

export default function MapScaleBarCard({ datasetId }: { datasetId?: string } = {}) {
  const activeId = useApp((s) => s.activeId);
  const dsId = datasetId ?? activeId;
  const bar = useApp((s) => mapViewFor(s.mapViews, dsId).scaleBar);
  return (
    <>
      <label className="qzk-field-lbl" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={bar !== undefined}
          onChange={(e) => setMapScaleBar(dsId, e.target.checked ? DEFAULT_SCALE_BAR : undefined)}
        />
        Scale bar
      </label>
      {bar && (
        <>
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Scale bar length (X units)
          </label>
          <BufferedNumberField
            value={bar.length}
            min={Number.MIN_VALUE}
            placeholder="auto"
            aria-label="Scale bar length"
            width={96}
            onValue={(length) => {
              const { length: _old, ...rest } = bar;
              setMapScaleBar(dsId, { ...rest, ...(length === undefined ? {} : { length }) });
            }}
          />
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Scale bar label
          </label>
          <input
            key={bar.label ?? ""}
            className="qz-input"
            aria-label="Scale bar label"
            placeholder="length and unit"
            maxLength={80}
            defaultValue={bar.label ?? ""}
            onBlur={(e) => {
              const { label: _old, ...rest } = bar;
              const label = e.target.value.trim();
              setMapScaleBar(dsId, { ...rest, ...(label ? { label } : {}) });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Scale bar corner
          </label>
          <Select
            aria-label="Scale bar corner"
            options={CORNER_OPTIONS}
            value={bar.corner}
            onChange={(e) => setMapScaleBar(dsId, { ...bar, corner: e.target.value as ScaleBarCorner })}
          />
          <label className="qzk-field-lbl" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
            Scale bar color
            <input
              type="color"
              aria-label="Scale bar color"
              value={bar.color}
              onChange={(e) => setMapScaleBar(dsId, { ...bar, color: e.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}
