// The gallery's "Variants" row under one group of plot types (plan item 39):
// smaller tiles that apply a parent type plus fixed options
// (lib/plotTypePresets.ts). Same contract as a type tile: a tile that cannot
// draw the active dataset stays visible but aria-disabled, the reason in its
// tooltip and accessible description.

import { useId } from "react";

import { applyPlotPreset } from "../../../lib/figureDialogActions";
import { plotPresetUnavailable, type PlotPresetDef } from "../../../lib/plotTypePresets";
import type { Dataset } from "../../../lib/types";

export default function PlotPresetRow({ presets, active, onClose }: { presets: readonly PlotPresetDef[]; active: Dataset | null; onClose: () => void }) {
  const hintId = useId();
  if (!presets.length) return null;
  return (
    <div role="group" aria-label="Variants" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {presets.map((p) => {
        const reason = plotPresetUnavailable(p.id, active);
        return (
          <button
            key={p.id}
            type="button"
            className="qz-btn"
            aria-label={p.label}
            aria-disabled={reason ? true : undefined}
            aria-describedby={reason ? `${hintId}-${p.id}` : undefined}
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
            {reason && <span id={`${hintId}-${p.id}`} hidden>{reason}</span>}
          </button>
        );
      })}
    </div>
  );
}
