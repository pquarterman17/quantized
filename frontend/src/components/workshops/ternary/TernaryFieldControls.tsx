// The "how to draw it" row of the ternary workshop (plan item 21): scatter,
// filled contour or heatmap; colormap; number of colour bands; contour lines
// and their labels. A controlled view over useTernary's `field`.

import { COLORMAPS, type ColormapName } from "../../../lib/colormap";
import { clampLevels, LEVELS_RANGE, type TernaryField, type TernaryKind } from "../../../lib/ternaryProject";
import { Select } from "../../primitives";

const KINDS = [
  { value: "scatter", label: "Scatter" },
  { value: "contour", label: "Filled contour" },
  { value: "heatmap", label: "Heatmap" },
];
const CMAPS = (Object.keys(COLORMAPS) as ColormapName[]).map((c) => ({ value: c, label: c }));

export default function TernaryFieldControls({
  field,
  setField,
}: {
  field: TernaryField;
  setField: (patch: Partial<TernaryField>) => void;
}) {
  const map = field.kind !== "scatter";
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div>
        <label className="qzk-field-lbl">Draw</label>
        <Select aria-label="Draw" options={KINDS} value={field.kind} onChange={(e) => setField({ kind: e.target.value as TernaryKind })} />
      </div>
      {map && (
        <div>
          <label className="qzk-field-lbl">Colormap</label>
          <Select aria-label="Colormap" options={CMAPS} value={field.cmap} onChange={(e) => setField({ cmap: e.target.value as ColormapName })} />
        </div>
      )}
      {field.kind === "contour" && (
        <>
          <div>
            <label className="qzk-field-lbl" htmlFor="ternary-levels">Levels</label>
            <input
              id="ternary-levels"
              className="qz-input"
              type="number"
              min={LEVELS_RANGE[0]}
              max={LEVELS_RANGE[1]}
              value={field.levels}
              onChange={(e) => setField({ levels: clampLevels(Number(e.target.value)) })}
              style={{ width: 64 }}
            />
          </div>
          <label className="qzk-field-lbl">
            <input type="checkbox" checked={field.lines} onChange={(e) => setField({ lines: e.target.checked })} /> lines
          </label>
          <label className="qzk-field-lbl">
            <input type="checkbox" checked={field.labels} onChange={(e) => setField({ labels: e.target.checked })} /> line labels
          </label>
        </>
      )}
    </div>
  );
}
