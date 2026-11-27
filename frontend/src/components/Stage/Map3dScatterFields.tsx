// The 3-D panel's controls for the SCATTER extras (lazy, beside `Map3dExtFields`):
// colour, size and group columns, error bar columns and the wall shadows. Each
// commit is ONE undoable edit of the stored view's `ext`; all of it is off by
// default and read, clamped, by `map3dScatter.readScatter`.

import { readScatter } from "./map3dScatter";
import type { Map3dView } from "../../lib/mapView3d";

const ROW = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11 } as const;
const HINT = { fontSize: 11, color: "var(--text-dim)", whiteSpace: "normal", lineHeight: 1.4 } as const;

type Put = (changes: Record<string, number | string | boolean | undefined>) => void;

/** `texts`: the sheet's text (categorical) columns, offered to "Groups from" by name. */
export default function Map3dScatterFields({ view3d, labels, texts = [], put }: { view3d: Map3dView; labels: string[]; texts?: string[]; put: Put }) {
  const o = readScatter(view3d.ext);
  const clear = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, undefined]));
  const pick = (name: string, key: string, value: number | null, none: string, also: string[] = [], text?: string | null) => (
    <label style={ROW}>
      {name}
      <select
        className="qz-select" aria-label={name} value={text ? `t:${text}` : (value ?? "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("t:")) return put({ scGroupText: v.slice(2), scGroup: undefined, ...clear(also) });
          put({ [key]: v === "" ? undefined : Number(v), ...(key === "scGroup" ? { scGroupText: undefined } : {}), ...(v !== "" ? clear(also) : {}) });
        }}
      >
        <option value="">{none}</option>
        {labels.map((l, k) => <option key={k} value={k}>{l}</option>)}
        {key === "scGroup" && texts.length > 0 && (
          <optgroup label="Text columns">
            {texts.map((t) => <option key={t} value={`t:${t}`}>{t} (text)</option>)}
          </optgroup>
        )}
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
      {pick("Colour by", "scColor", o.color, "z (height)", ["scGroup", "scGroupText"])}
      {pick("Groups from", "scGroup", o.group, "(none)", ["scColor"], o.groupText)}
      {pick("Size by", "scSize", o.size, "(one size)")}
      {pick("X error", "scErrX", o.err[0], "(none)")}
      {pick("Y error", "scErrY", o.err[1], "(none)")}
      {pick("Z error", "scErrZ", o.err[2], "(none)")}
      {wall("Shadow on the floor (XY)", "wallXY", o.walls[0])}
      {wall("Shadow on the XZ wall", "wallXZ", o.walls[1])}
      {wall("Shadow on the YZ wall", "wallYZ", o.walls[2])}
      <div style={HINT}>
        Columns plot the source rows (a gap in a picked column leaves the row out). Groups take up to 10 distinct values, each its own colour and a legend. Error columns are the half length of each bar; shadows land on the back panes.
      </div>
    </>
  );
}
