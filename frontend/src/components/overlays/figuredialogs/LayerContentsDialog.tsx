// Origin's Layer Contents (gap audit 3 N1): the focused graph's curves in one
// dialog — remove, reorder, re-bind a curve to another dataset / X / Y, and
// add curves from any dataset — replacing "Add curve from…"'s two chained
// prompts. Edits a draft (lib/layerContents.ts); Apply commits it as ONE undo
// step (store/layerContentsApply.ts), Cancel changes nothing. Mounted in the
// lazy `FigureDialogs` host, which owns the modal frame and focus.

import { useId, useMemo, useState } from "react";

import { layerRowsChanged, layerRowsOf, layerRowsProblems, newCurve, type LayerRow } from "../../../lib/layerContents";
import { curvesForDatasets, linkedGraphReaches } from "../../../lib/linkedCurves";
import { is2DMap } from "../../../lib/mapdata";
import { primaryChannel } from "../../../lib/plotdataExtras";
import type { Dataset, LinkedCurve } from "../../../lib/types";
import { activeLayerCurves, applyLayerContents } from "../../../store/layerContentsApply";
import { useApp } from "../../../store/useApp";
import CurveSourcePicker, { type CurveBinding } from "./CurveSourcePicker";

/** What the list shows for a curve: its legend text, from the source's
 *  current name where the curve follows it. */
function rowText(c: LinkedCurve, byId: Map<string, Dataset>): string {
  const ds = byId.get(c.datasetId);
  if (!ds) return `${c.label || "curve"} (source missing)`;
  const col = c.yKey >= 0 ? ds.data.labels[c.yKey] : undefined;
  const label = c.labelFrom === "name" ? ds.name : c.labelFrom === "nameCol" && col !== undefined ? `${ds.name}: ${col}` : c.label;
  return col === undefined ? `${label} (column missing)` : label;
}

function bindingText(c: LinkedCurve, byId: Map<string, Dataset>): string {
  const ds = byId.get(c.datasetId);
  if (!ds) return "";
  const name = (k: number) => ds.data.labels[k] ?? `col ${k + 1}`;
  return `${ds.name} — X: ${c.xKey === null ? "its own X" : name(c.xKey)}, Y: ${c.yKey >= 0 ? name(c.yKey) : "?"}`;
}

/** A re-bound or added curve over `b`: a real Y names it; otherwise a
 *  placeholder the problems line holds back from Apply. */
function boundCurve(b: CurveBinding, byId: Map<string, Dataset>, keep?: LinkedCurve): LinkedCurve {
  const ds = byId.get(b.datasetId);
  if (ds && b.yKey >= 0 && b.yKey < ds.data.labels.length) return newCurve(ds, b.xKey, b.yKey);
  return { datasetId: b.datasetId, xKey: b.xKey, yKey: b.yKey, label: keep?.label ?? "" };
}

const iconBtn = { minWidth: 28, padding: "0 6px" } as const;

export default function LayerContentsDialog({ onClose }: { onClose: () => void }) {
  const datasets = useApp((s) => s.datasets);
  const target = useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
  const [old] = useState(activeLayerCurves);
  const [rows, setRows] = useState<LayerRow[]>(() => layerRowsOf(old));
  const [editing, setEditing] = useState<number | null>(null);
  const byId = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets]);
  // A live graph never draws from itself; a plain dataset may re-bind to its own columns.
  const sources = useMemo(
    () => datasets.filter((d) => !is2DMap(d.data) && !(target?.linkedCurves && d.id === target.id)),
    [datasets, target],
  );
  const firstSource = sources.find((d) => d.id !== target?.id) ?? sources[0];
  const [adding, setAdding] = useState<CurveBinding>(() => ({
    datasetId: firstSource?.id ?? "",
    xKey: null,
    yKey: firstSource ? (primaryChannel(firstSource.data) ?? -1) : -1,
  }));
  const problemsId = useId();
  if (!target) return <p>Open a graph first.</p>;

  const problems = layerRowsProblems(old, rows, datasets, (id) => !!target.linkedCurves && linkedGraphReaches(datasets, id, target.id));
  const changed = layerRowsChanged(old, rows);
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addSource = byId.get(adding.datasetId);
  const addOk = !!addSource && adding.yKey >= 0 && adding.yKey < addSource.data.labels.length;
  // A NEW curve may start on the picked dataset's main channel (it is shown
  // before Add); only a re-bind of an existing curve must pick Y explicitly.
  const pickAdd = (b: CurveBinding) => {
    const ds = b.datasetId !== adding.datasetId ? byId.get(b.datasetId) : undefined;
    setAdding(ds ? { ...b, yKey: primaryChannel(ds.data) ?? -1 } : b);
  };
  const addAll = () => {
    if (!addSource) return;
    const curves = curvesForDatasets([addSource], (d) => primaryChannel(d.data));
    setRows((rs) => [...rs, ...curves.map((curve) => ({ curve, from: null }))]);
  };
  const apply = () => {
    if (!changed || applyLayerContents(target.id, rows, old)) onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 420 }}>
      <div className="qzk-ds-meta">{target.name}</div>
      <h3 style={{ margin: "4px 0" }}>Curves</h3>
      {rows.length === 0 && <p className="qzk-ds-meta">No curves — add one below.</p>}
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r, i) => {
          const name = `Curve ${i + 1}`;
          return (
            <li key={`${r.from ?? "new"}-${i}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ flex: 1 }} title={bindingText(r.curve, byId)}>
                  {rowText(r.curve, byId)}
                  {r.from === null && <span className="qzk-ds-meta"> (new)</span>}
                </span>
                <button type="button" className="qz-btn" style={iconBtn} aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="qz-btn" style={iconBtn} aria-label={`Move ${name} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="qz-btn" aria-pressed={editing === i} aria-label={`Change data of ${name}`} onClick={() => setEditing(editing === i ? null : i)}>Data…</button>
                <button type="button" className="qz-btn" style={iconBtn} aria-label={`Remove ${name}`} onClick={() => { setRows((rs) => rs.filter((_, k) => k !== i)); setEditing(null); }}>✕</button>
              </div>
              {editing === i && (
                <CurveSourcePicker
                  label={name}
                  sources={sources}
                  value={r.curve}
                  onChange={(b) => setRows((rs) => rs.map((row, k) => (k === i ? { ...row, curve: boundCurve(b, byId, row.curve) } : row)))}
                />
              )}
            </li>
          );
        })}
      </ol>

      <h3 style={{ margin: "4px 0" }}>Add</h3>
      {sources.length === 0 ? (
        <p className="qzk-ds-meta">No other dataset to take a curve from.</p>
      ) : (
        <>
          <CurveSourcePicker label="New curve" sources={sources} value={adding} onChange={pickAdd} />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="qz-btn" disabled={!addOk} onClick={() => setRows((rs) => [...rs, { curve: boundCurve(adding, byId), from: null }])}>Add curve</button>
            <button type="button" className="qz-btn" disabled={!addSource} onClick={addAll}>Add all its Y columns</button>
          </div>
        </>
      )}

      {problems.length > 0 && (
        <ul id={problemsId} style={{ margin: 0, paddingLeft: 18, color: "var(--danger)" }}>
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="qz-btn qz-primary"
          disabled={problems.length > 0}
          aria-describedby={problems.length > 0 ? problemsId : undefined}
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
