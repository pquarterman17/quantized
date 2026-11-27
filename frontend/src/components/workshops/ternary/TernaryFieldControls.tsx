// The "how to draw it" row of the ternary workshop (plan item 21): scatter,
// filled contour or heatmap; colormap; number of colour bands; contour lines
// and their labels. A controlled view over useTernary's `field`.

import { useEffect, useState } from "react";

import { COLORMAPS, type ColormapName } from "../../../lib/colormap";
import { clampLevels, isMapKind, LEVELS_RANGE, validZLimits, type TernaryField, type TernaryKind } from "../../../lib/ternaryProject";
import { Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import TernaryPathControls from "./TernaryPathControls";

const KINDS = [
  { value: "scatter", label: "Scatter" },
  { value: "contour", label: "Filled contour" },
  { value: "heatmap", label: "Heatmap" },
  { value: "line", label: "Line" },
  { value: "vector", label: "Vector" },
];
const CMAPS = (Object.keys(COLORMAPS) as ColormapName[]).map((c) => ({ value: c, label: c }));

const limText = (v: number | undefined): string => (v === undefined ? "" : String(v));

/** Z min / Z max: both blank = the data's range; both filled with min < max =
 *  an explicit range (what the route's `z_limits` takes). Anything else is
 *  refused with its reason and the last good range stays. */
function ZLimitsField({ field, setField }: { field: TernaryField; setField: (patch: Partial<TernaryField>) => void }) {
  const [lo, setLo] = useState(limText(field.zLimits?.[0]));
  const [hi, setHi] = useState(limText(field.zLimits?.[1]));
  const [error, setError] = useState<string | null>(null);
  // A dataset switch (or an undo-free reload) brings its own saved range.
  useEffect(() => {
    setLo(limText(field.zLimits?.[0]));
    setHi(limText(field.zLimits?.[1]));
    setError(null);
  }, [field.zLimits]);
  function commit(): void {
    if (lo.trim() === "" && hi.trim() === "") {
      setError(null);
      if (field.zLimits) setField({ zLimits: null });
      return;
    }
    const range = validZLimits([Number(lo), Number(hi)]);
    if (lo.trim() === "" || hi.trim() === "" || !range) {
      setError("Z range needs both ends, with min below max (blank both for automatic).");
      return;
    }
    setError(null);
    if (!field.zLimits || field.zLimits[0] !== range[0] || field.zLimits[1] !== range[1]) setField({ zLimits: range });
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") commit();
  };
  return (
    <div>
      <label className="qzk-field-lbl">Z range</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <NumberField aria-label="Z min" placeholder="auto" width={64} value={lo} onChange={setLo} onBlur={commit} onKeyDown={onKey} />
        <span style={{ color: "var(--text-faint)" }}>–</span>
        <NumberField aria-label="Z max" placeholder="auto" width={64} value={hi} onChange={setHi} onBlur={commit} onKeyDown={onKey} />
      </div>
      {error && <div role="alert" className="qzk-helptext" style={{ color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}

export default function TernaryFieldControls({
  field,
  setField,
  colored,
}: {
  field: TernaryField;
  setField: (patch: Partial<TernaryField>) => void;
  /** A colour / series / Z column is picked. */
  colored: boolean;
}) {
  const map = isMapKind(field.kind);
  const path = field.kind === "line" || field.kind === "vector";
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div>
        <label className="qzk-field-lbl">Draw</label>
        <Select aria-label="Draw" options={KINDS} value={field.kind} onChange={(e) => setField({ kind: e.target.value as TernaryKind })} />
      </div>
      {(map || (field.kind === "vector" && colored)) && (
        <div>
          <label className="qzk-field-lbl">Colormap</label>
          <Select aria-label="Colormap" options={CMAPS} value={field.cmap} onChange={(e) => setField({ cmap: e.target.value as ColormapName })} />
        </div>
      )}
      {map && <ZLimitsField field={field} setField={setField} />}
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
      {path && <TernaryPathControls field={field} setField={setField} autoColor={colored} />}
    </div>
  );
}
