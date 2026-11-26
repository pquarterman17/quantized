// Inspector control: print each cell's value on the 2-D map's heatmap
// (`MapViewState.cellLabels`, lib/cellLabels.ts). Format and precision, text
// colour chosen against each cell's colour, and cells too small to read are
// skipped on their own. The vector export prints the same labels.
import { CELL_FORMATS, DEFAULT_CELL_LABELS, MAX_CELL_PRECISION, type CellLabelFormat } from "../../lib/cellLabels";
import { mapViewFor } from "../../lib/mapView";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";

const FORMATS = CELL_FORMATS.map((f) => ({ value: f, label: f }));
const PRECISIONS = Array.from({ length: MAX_CELL_PRECISION + 1 }, (_, n) => ({ value: String(n), label: String(n) }));

export default function MapCellLabels({ datasetId }: { datasetId?: string } = {}) {
  const activeId = useApp((s) => s.activeId);
  const dsId = datasetId ?? activeId;
  const labels = useApp((s) => mapViewFor(s.mapViews, dsId).cellLabels);
  const setMapCellLabels = useApp((s) => s.setMapCellLabels);
  return (
    <>
      <label className="qzk-field-lbl" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={labels !== undefined}
          onChange={(e) => setMapCellLabels(dsId, e.target.checked ? DEFAULT_CELL_LABELS : undefined)}
        />
        Cell values
      </label>
      {labels && (
        <>
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Cell value format
          </label>
          <Select
            aria-label="Cell value format"
            options={FORMATS}
            value={labels.format}
            onChange={(e) => setMapCellLabels(dsId, { ...labels, format: e.target.value as CellLabelFormat })}
          />
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Cell value precision
          </label>
          <Select
            aria-label="Cell value precision"
            options={PRECISIONS}
            value={String(labels.precision)}
            onChange={(e) => setMapCellLabels(dsId, { ...labels, precision: Number(e.target.value) })}
          />
        </>
      )}
    </>
  );
}
