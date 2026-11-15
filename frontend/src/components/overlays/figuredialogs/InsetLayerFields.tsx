// An inset graph layer's curves and axes in Layer properties (origin gap
// audit 3 #15). Curves use Layer Contents' model and picker: a dataset, its
// X and its Y; the list shows a curve whose source is gone as missing (it is
// not drawn, and is never rebound). Each axis: range (blank = automatic),
// scale, title and major tick step (blank = automatic).

import { useState } from "react";

import type { AxisDraft, LayerDraft } from "../../../lib/graphLayerDraft";
import { newCurve } from "../../../lib/layerContents";
import { is2DMap } from "../../../lib/mapdata";
import { primaryChannel } from "../../../lib/plotdataExtras";
import type { Dataset, LinkedCurve } from "../../../lib/types";
import CurveSourcePicker, { type CurveBinding } from "./CurveSourcePicker";

function curveText(c: LinkedCurve, byId: Map<string, Dataset>): string {
  const ds = byId.get(c.datasetId);
  if (!ds) return `${c.label || "curve"} (source missing)`;
  const y = ds.data.labels[c.yKey];
  if (y === undefined || (c.xKey !== null && ds.data.labels[c.xKey] === undefined)) return `${ds.name} (column missing)`;
  return `${ds.name}: ${y} vs ${c.xKey === null ? "its X" : ds.data.labels[c.xKey]}`;
}

function AxisFields({ name, value, onChange }: { name: string; value: AxisDraft; onChange: (a: AxisDraft) => void }) {
  const field = (k: "from" | "to" | "label" | "step", label: string, placeholder: string) => (
    <label className="qzk-field-lbl" style={{ display: "grid", gap: 2 }}>
      <span>{label}</span>
      <input className={k === "label" ? "qz-input" : "qz-input qz-num"} aria-label={`${name} ${label}`} value={value[k]}
        placeholder={placeholder} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
    </label>
  );
  return (
    <fieldset style={{ border: "1px solid var(--border)", borderRadius: 4, padding: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      <legend>{name}</legend>
      {field("from", "From", "auto")}
      {field("to", "To", "auto")}
      <label className="qzk-field-lbl" style={{ display: "grid", gap: 2 }}>
        <span>Scale</span>
        <select className="qz-select" aria-label={`${name} scale`} value={value.scale}
          onChange={(e) => onChange({ ...value, scale: e.target.value === "log" ? "log" : "linear" })}>
          <option value="linear">Linear</option>
          <option value="log">Log10</option>
        </select>
      </label>
      {field("step", "Tick step", "auto")}
      <div style={{ gridColumn: "1 / -1" }}>{field("label", "Title", "none")}</div>
    </fieldset>
  );
}

export default function InsetLayerFields({
  draft,
  datasets,
  onChange,
}: {
  draft: LayerDraft;
  datasets: readonly Dataset[];
  onChange: (patch: Partial<LayerDraft>) => void;
}) {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  // Any dataset with columns can feed an inset (another sample, a derivative, a live graph).
  const sources = datasets.filter((d) => !is2DMap(d.data) && d.data.labels.length > 0);
  const first = sources[0];
  const [adding, setAdding] = useState<CurveBinding>(() => ({
    datasetId: first?.id ?? "",
    xKey: null,
    yKey: first ? (primaryChannel(first.data) ?? -1) : -1,
  }));
  const addSource = byId.get(adding.datasetId);
  const addOk = !!addSource && adding.yKey >= 0 && adding.yKey < addSource.data.labels.length;
  // A picked dataset starts on its main channel (shown before Add).
  const pick = (b: CurveBinding) => {
    const ds = b.yKey < 0 ? byId.get(b.datasetId) : undefined;
    setAdding(ds ? { ...b, yKey: primaryChannel(ds.data) ?? -1 } : b);
  };

  return (
    <>
      <h3 style={{ margin: "4px 0" }}>Curves</h3>
      {draft.curves.length === 0 && <p className="qzk-ds-meta" style={{ margin: 0 }}>No curves yet — add one below.</p>}
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
        {draft.curves.map((c, i) => (
          <li key={`${c.datasetId}-${c.xKey}-${c.yKey}-${i}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ flex: 1 }}>{curveText(c, byId)}</span>
            <button type="button" className="qz-btn" aria-label={`Remove curve ${i + 1}`}
              onClick={() => onChange({ curves: draft.curves.filter((_, k) => k !== i) })}>✕</button>
          </li>
        ))}
      </ol>
      {sources.length === 0 ? (
        <p className="qzk-ds-meta">No dataset to take a curve from.</p>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <CurveSourcePicker label="New curve" sources={sources} value={adding} onChange={pick} />
          <button type="button" className="qz-btn" disabled={!addOk}
            onClick={() => addSource && onChange({ curves: [...draft.curves, newCurve(addSource, adding.xKey, adding.yKey)] })}>
            Add curve
          </button>
        </div>
      )}
      <label className="qzk-field-lbl" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span>Draw as</span>
        <select className="qz-select" aria-label="Draw as" value={draft.mark}
          onChange={(e) => onChange({ mark: e.target.value as LayerDraft["mark"] })}>
          <option value="line">Line</option>
          <option value="scatter">Scatter</option>
          <option value="linesymbol">Line + symbol</option>
        </select>
      </label>
      <AxisFields name="X axis" value={draft.x} onChange={(x) => onChange({ x })} />
      <AxisFields name="Y axis" value={draft.y} onChange={(y) => onChange({ y })} />
    </>
  );
}
