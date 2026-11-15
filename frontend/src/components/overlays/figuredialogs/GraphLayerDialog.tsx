// Layer properties (origin gap audit 3 #15): one graph layer of the focused
// plot — its position and size in percent of the plot frame (what a drag
// sets, typed), an inset graph's curves and axes, a table's cells, an
// image's name. Edits a draft (lib/graphLayerDraft.ts); Apply commits it as
// ONE undo step, Delete removes the layer (one step), Cancel changes nothing.
// Mounted in the lazy `FigureDialogs` host (modal frame and focus).

import { useId, useMemo, useState } from "react";

import { draftErrors, draftOf, layerFromDraft, type LayerDraft } from "../../../lib/graphLayerDraft";
import { sanitizeLayers } from "../../../lib/graphLayers";
import { editLayers, removeLayer } from "../../../store/graphLayerEdit";
import { useApp } from "../../../store/useApp";
import InsetLayerFields from "./InsetLayerFields";
import TableLayerFields from "./TableLayerFields";

const AT_FIELDS = ["Left", "Top", "Width", "Height"] as const;

export default function GraphLayerDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const raw = useApp((s) => s.layers);
  const layer = useMemo(() => sanitizeLayers(raw).find((l) => l.id === id) ?? null, [raw, id]);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const [draft, setDraft] = useState<LayerDraft | null>(() => (layer ? draftOf(layer) : null));
  const problemsId = useId();
  if (!layer || !draft) return <p>This layer is no longer on the plot.</p>;
  const set = (patch: Partial<LayerDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const errors = draftErrors(draft, layer.kind);
  const apply = () => {
    if (errors.length) return;
    const next = layerFromDraft(layer, draft);
    editLayers((ls) => ls.map((l) => (l.id === id ? next : l)), `edit ${layer.kind === "inset" ? "inset graph" : layer.kind}`);
    onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 420 }}>
      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 4, padding: 6, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        <legend>Position (% of the plot frame)</legend>
        {AT_FIELDS.map((name, i) => (
          <label key={name} className="qzk-field-lbl" style={{ display: "grid", gap: 2 }}>
            <span>{name}</span>
            <input className="qz-input qz-num" aria-label={`${name} (%)`} value={draft.at[i]}
              onChange={(e) => set({ at: draft.at.map((v, k) => (k === i ? e.target.value : v)) as LayerDraft["at"] })} />
          </label>
        ))}
      </fieldset>
      {layer.kind === "inset" && <InsetLayerFields draft={draft} datasets={datasets} onChange={set} />}
      {layer.kind === "table" && <TableLayerFields draft={draft} datasets={datasets} activeId={activeId} onChange={set} />}
      {layer.kind === "image" && (
        <label className="qzk-field-lbl" style={{ display: "grid", gap: 2 }}>
          <span>Name (its description for screen readers)</span>
          <input className="qz-input" aria-label="Image name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
      )}
      {errors.length > 0 && (
        <ul id={problemsId} style={{ margin: 0, paddingLeft: 18, color: "var(--danger)" }}>
          {errors.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="qz-btn" onClick={() => { removeLayer(id); onClose(); }}>Delete layer</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="qz-btn qz-primary" disabled={errors.length > 0}
          aria-describedby={errors.length > 0 ? problemsId : undefined} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
