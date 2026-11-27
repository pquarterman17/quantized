// The line / vector style row of the ternary workshop (plan item 25): colour,
// width (pt), dash and markers for a line; colour, width, head size and head
// style for a vector. A controlled view over `field.path` (validated and
// written by ternaryPathStyle.ts).

import type { TernaryField } from "../../../lib/ternaryProject";
import { Select } from "../../primitives";
import {
  HEAD_RANGE,
  PATH_DASHES,
  readPathStyle,
  WIDTH_RANGE,
  withPathStyle,
  type HeadStyle,
  type PathDash,
  type TernaryPathStyle,
} from "./ternaryPathStyle";

const DASH_OPTIONS = PATH_DASHES.map((d) => ({ value: d, label: d }));
const HEAD_OPTIONS = [
  { value: "filled", label: "filled" },
  { value: "open", label: "open" },
];

export default function TernaryPathControls({
  field,
  setField,
  autoColor,
}: {
  field: TernaryField;
  setField: (patch: Partial<TernaryField>) => void;
  /** True when the colour comes from a column (series / value), so a fixed colour does not apply. */
  autoColor: boolean;
}) {
  const style = readPathStyle(field);
  const set = (patch: Partial<TernaryPathStyle>): void => setField({ path: withPathStyle(field, patch).path });
  const vector = field.kind === "vector";
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div>
        <label className="qzk-field-lbl" htmlFor="ternary-path-color">Colour</label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            id="ternary-path-color"
            type="color"
            value={style.color ?? "#1f77b4"}
            disabled={autoColor}
            onChange={(e) => set({ color: e.target.value })}
          />
          <label className="qzk-field-lbl">
            <input type="checkbox" checked={style.color === null || autoColor} disabled={autoColor} onChange={(e) => set({ color: e.target.checked ? null : "#1f77b4" })} /> auto
          </label>
        </div>
      </div>
      <div>
        <label className="qzk-field-lbl" htmlFor="ternary-path-width">Width (pt)</label>
        <input
          id="ternary-path-width"
          className="qz-input"
          type="number"
          step={0.25}
          min={WIDTH_RANGE[0]}
          max={WIDTH_RANGE[1]}
          value={style.width}
          onChange={(e) => set({ width: Number(e.target.value) })}
          style={{ width: 64 }}
        />
      </div>
      {!vector && (
        <>
          <div>
            <label className="qzk-field-lbl">Dash</label>
            <Select aria-label="Dash" options={DASH_OPTIONS} value={style.dash} onChange={(e) => set({ dash: e.target.value as PathDash })} />
          </div>
          <label className="qzk-field-lbl">
            <input type="checkbox" checked={style.markers} onChange={(e) => set({ markers: e.target.checked })} /> markers
          </label>
        </>
      )}
      {vector && (
        <>
          <div>
            <label className="qzk-field-lbl" htmlFor="ternary-head-size">Head size</label>
            <input
              id="ternary-head-size"
              className="qz-input"
              type="number"
              step={0.25}
              min={HEAD_RANGE[0]}
              max={HEAD_RANGE[1]}
              value={style.headSize}
              onChange={(e) => set({ headSize: Number(e.target.value) })}
              style={{ width: 64 }}
            />
          </div>
          <div>
            <label className="qzk-field-lbl">Head</label>
            <Select aria-label="Head" options={HEAD_OPTIONS} value={style.head} onChange={(e) => set({ head: e.target.value as HeadStyle })} />
          </div>
        </>
      )}
    </div>
  );
}
