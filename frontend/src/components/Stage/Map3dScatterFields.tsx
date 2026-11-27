// The 3-D panel's controls for the SCATTER extras (lazy, beside `Map3dExtFields`):
// colour, size and group columns, error bar columns and the wall shadows. Each
// commit is ONE undoable edit of the stored view's `ext`; all of it is off by
// default and read, clamped, by `map3dScatter.readScatter`.

import { readScatter } from "./map3dScatter";
import type { Map3dView } from "../../lib/mapView3d";

const ROW = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11 } as const;
const HINT = { fontSize: 11, color: "var(--text-dim)", whiteSpace: "normal", lineHeight: 1.4 } as const;

type Put = (changes: Record<string, number | boolean | undefined>) => void;

export default function Map3dScatterFields({ view3d, labels, put }: { view3d: Map3dView; labels: string[]; put: Put }) {
  const o = readScatter(view3d.ext);
  const pick = (name: string, key: string, value: number | null, none: string, also?: string) => (
    <label style={ROW}>
      {name}
      <select
        className="qz-select" aria-label={name} value={value ?? ""}
        onChange={(e) => put({ [key]: e.target.value === "" ? undefined : Number(e.target.value), ...(also && e.target.value !== "" ? { [also]: undefined } : {}) })}
      >
        <option value="">{none}</option>
        {labels.map((l, k) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
  const wall = (name: string, key: string, on: boolean) => (
    <label style={{ ...ROW, justifyContent: "flex-start" }}>
      <input type="checkbox" aria-label={name} checked={on} onChange={(e) => put({ [key]: e.target.checked ? true : undefined })} />
      {name}
    </label>
  );
  return (
    <>
      {pick("Colour by", "scColor", o.color, "z (height)", "scGroup")}
      {pick("Groups from", "scGroup", o.group, "(none)", "scColor")}
      {pick("Size by", "scSize", o.size, "(one size)")}
      {pick("X error", "scErrX", o.err[0], "(none)")}
      {pick("Y error", "scErrY", o.err[1], "(none)")}
      {pick("Z error", "scErrZ", o.err[2], "(none)")}
      {wall("Shadow on the floor (XY)", "wallXY", o.walls[0])}
      {wall("Shadow on the XZ wall", "wallXZ", o.walls[1])}
      {wall("Shadow on the YZ wall", "wallYZ", o.walls[2])}
      <label style={{ ...ROW, justifyContent: "flex-start" }}>
        <input type="checkbox" aria-label="Error bar end caps" checked={o.caps} onChange={(e) => put({ scErrCaps: e.target.checked ? true : undefined })} />
        End caps on the error bars
      </label>
      <div style={HINT}>
        Columns plot the source rows (a gap in a picked column leaves the row out). Groups take up to 10 distinct values, each its own colour and a legend. Error columns are the half length of each bar; shadows land on the back panes.
      </div>
    </>
  );
}
