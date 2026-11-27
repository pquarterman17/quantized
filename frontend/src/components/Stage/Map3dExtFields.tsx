// The 3-D panel's controls for the BAR and VECTOR kinds (lazy, beside
// `Map3dPanel`): bar width / depth and colour, and the vector columns, form,
// scale, arrowhead size and colour. Each commit is ONE undoable edit of the
// stored 3-D view's `ext` (read, clamped, by `map3dExt.readExt`).

import { useState } from "react";

import { mapColumns } from "../../lib/mapdataFetch";
import type { Map3dView } from "../../lib/mapView3d";
import { useApp } from "../../store/useApp";
import { readExt } from "./map3dExt";
import Map3dScatterFields from "./Map3dScatterFields";

const ROW = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11 } as const;
const HINT = { fontSize: 11, color: "var(--text-dim)", whiteSpace: "normal", lineHeight: 1.4 } as const;

type Put = (key: string, value: number | string | boolean | undefined) => void;

/** A number that commits on blur / Enter and refuses a value outside (lo, hi]. */
function RangeField({ label, value, lo, hi, onCommit }: { label: string; value: number; lo: number; hi: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const n = Number(draft);
  const bad = draft !== null && (draft.trim() === "" || !Number.isFinite(n) || n < lo || n > hi);
  const commit = () => {
    if (draft === null) return;
    if (!bad) onCommit(n);
    if (!bad || draft.trim() === "") setDraft(null);
  };
  return (
    <label style={ROW}>
      {label}
      <input
        type="number" step="any" min={lo} max={hi} aria-label={label} aria-invalid={bad}
        title={bad ? `${label} must be from ${lo} to ${hi}` : `${lo} to ${hi}`}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        style={{ width: 70, ...(bad ? { borderColor: "var(--danger)" } : {}) }}
      />
    </label>
  );
}

function ColorField({ label, value, fallback, onChange, none }: { label: string; value: string | null; fallback: string; onChange: (v: string | undefined) => void; none: string }) {
  return (
    <div style={ROW}>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="checkbox" aria-label={`${label}: fixed colour`} checked={value !== null} onChange={(e) => onChange(e.target.checked ? fallback : undefined)} />
        {value !== null ? label : none}
      </label>
      {value !== null && <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export default function Map3dExtFields({ datasetId, view3d, edit }: { datasetId: string | null; view3d: Map3dView; edit: (p: Partial<Map3dView>) => void }) {
  const ds = useApp((s) => s.datasets.find((d) => d.id === datasetId));
  const o = readExt(view3d.ext);
  const put: Put = (key, value) => {
    const { [key]: _old, ...rest } = view3d.ext ?? {};
    edit({ ext: value === undefined ? rest : { ...rest, [key]: value } });
  };
  if (view3d.kind === "scatter3d") {
    const labels = ds ? mapColumns(ds.data).labels : [];
    const putAll = (changes: Record<string, number | boolean | undefined>) => {
      const next: Record<string, number | string | boolean> = { ...(view3d.ext ?? {}) };
      for (const [k, v] of Object.entries(changes)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      edit({ ext: Object.keys(next).length ? next : undefined });
    };
    return <Map3dScatterFields view3d={view3d} labels={labels} put={putAll} />;
  }
  if (view3d.kind === "bars3d") {
    return (
      <>
        <RangeField label="Bar width" value={o.barWidth} lo={0.05} hi={1} onCommit={(v) => put("barW", v)} />
        <RangeField label="Bar depth" value={o.barDepth} lo={0.05} hi={1} onCommit={(v) => put("barD", v)} />
        <ColorField label="Bar colour" value={o.barColor} fallback="#4c78a8" none="Colour by height" onChange={(v) => put("barColor", v)} />
        <div style={HINT}>Width and depth are fractions of the spacing between positions (1 = touching). At most 10,000 bars.</div>
      </>
    );
  }
  if (view3d.kind !== "vectors3d") return null;
  const labels = ds ? mapColumns(ds.data).labels : [];
  const pick = (name: string, key: string, i: number) => (
    <label style={ROW}>
      {name}
      <select className="qz-select" aria-label={`Vector ${name}`} value={o.vec[i] ?? ""} onChange={(e) => put(key, e.target.value === "" ? undefined : Number(e.target.value))}>
        <option value="">(pick a column)</option>
        {labels.map((l, k) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <>
      {pick(o.vecEnd ? "End x" : "dX", "vecDx", 0)}
      {pick(o.vecEnd ? "End y" : "dY", "vecDy", 1)}
      {pick(o.vecEnd ? "End z" : "dZ", "vecDz", 2)}
      <label style={ROW}>
        Columns are
        <select className="qz-select" aria-label="Vector form" value={o.vecEnd ? "end" : "delta"} onChange={(e) => put("vecEnd", e.target.value === "end")}>
          <option value="delta">Deltas from the start</option>
          <option value="end">End points</option>
        </select>
      </label>
      <RangeField label="Length scale" value={o.vecScale} lo={1e-6} hi={1e6} onCommit={(v) => put("vecScale", v)} />
      <RangeField label="Arrowhead" value={o.vecHead} lo={0.05} hi={0.5} onCommit={(v) => put("vecHead", v)} />
      <ColorField label="Vector colour" value={o.vecColor} fallback="#2a6fdb" none="Default colour" onChange={(v) => put("vecColor", v)} />
      <div style={HINT}>The map's X, Y and Z channels are the start; arrowhead size is a fraction of each arrow's length. Rows with a gap or no length are not drawn.</div>
    </>
  );
}
