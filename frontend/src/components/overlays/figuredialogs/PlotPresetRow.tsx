// The gallery's "Variants" block under one group of plot types (plan item 39):
// smaller tiles that apply a parent type plus fixed options
// (lib/plotTypePresets.ts), grouped by family (the plot type they open, with a
// heading). A family shows its first FAMILY_VISIBLE tiles and folds the rest
// behind a "more" button (collapsed on every open; view state only, nothing is
// saved). Same tile contract as a type tile: a tile that cannot draw the active
// dataset stays visible but aria-disabled, the reason in its tooltip and
// accessible description.

import { useId, useState } from "react";

import { applyPlotPreset } from "../../../lib/figureDialogActions";
import { FAMILY_VISIBLE, type PresetFamily } from "../../../lib/plotPresetFamilies";
import { plotPresetUnavailable, type PlotPresetDef } from "../../../lib/plotTypePresets";
import type { Dataset } from "../../../lib/types";

function PresetTile({ p, active, onClose }: { p: PlotPresetDef; active: Dataset | null; onClose: () => void }) {
  const hintId = useId();
  const reason = plotPresetUnavailable(p.id, active);
  return (
    <button
      type="button"
      className="qz-btn"
      aria-label={p.label}
      aria-disabled={reason ? true : undefined}
      aria-describedby={reason ? hintId : undefined}
      title={reason ?? p.description}
      onClick={() => {
        if (reason) return;
        applyPlotPreset(p.id);
        onClose();
      }}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", height: "auto", opacity: reason ? 0.45 : 1, cursor: "default" }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{p.glyph}</span>
      <span style={{ fontSize: 11 }}>{p.label}</span>
      {reason && <span id={hintId} hidden>{reason}</span>}
    </button>
  );
}

function FamilyTiles({ family, active, onClose }: { family: PresetFamily; active: Dataset | null; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hidden = Math.max(0, family.presets.length - FAMILY_VISIBLE);
  const shown = open ? family.presets : family.presets.slice(0, FAMILY_VISIBLE);
  return (
    <div role="group" aria-label={`${family.label} variants`} style={{ marginTop: 6 }}>
      <h4 style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)" }}>{family.label}</h4>
      <div id={listId} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {shown.map((p) => <PresetTile key={p.id} p={p} active={active} onClose={onClose} />)}
        {hidden > 0 && (
          <button
            type="button"
            className="qz-btn"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? `Show fewer ${family.label} variants` : `Show ${hidden} more ${family.label} variants`}
            onClick={() => setOpen((o) => !o)}
            style={{ padding: "4px 8px", height: "auto", fontSize: 11, cursor: "default" }}
          >
            {open ? "fewer" : `+${hidden} more`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PlotPresetRow({ families, active, onClose }: { families: readonly PresetFamily[]; active: Dataset | null; onClose: () => void }) {
  if (!families.length) return null;
  return (
    <div role="group" aria-label="Variants">
      {families.map((f) => <FamilyTiles key={f.parent} family={f} active={active} onClose={onClose} />)}
    </div>
  );
}
