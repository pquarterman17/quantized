// Plot ▸ "Plot type…" (figures-audit #8): Origin's plot-type gallery over
// the renderers this app already has (see plotTypes.ts). A tile that cannot
// draw the active dataset stays visible but disabled, its reason in the
// tooltip and its accessible description, rather than silently missing.

import { useId } from "react";

import { applyPlotType } from "../../../lib/figureDialogActions";
import { useActiveDataset } from "../../../store/useApp";
import { useAuxFigureStore } from "../../workshops/ternary/auxFigureStore";
import { PLOT_TYPES, plotTypeUnavailable } from "../../../lib/plotTypes";

export default function PlotTypeGallery({ onClose }: { onClose: () => void }) {
  const active = useActiveDataset();
  const hintId = useId();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }} role="group" aria-label="Plot types">
      {PLOT_TYPES.map((t) => {
        const reason = plotTypeUnavailable(t.id, active);
        return (
          <button
            key={t.id}
            type="button"
            className="qz-btn"
            aria-label={t.label}
            aria-disabled={reason ? true : undefined}
            aria-describedby={reason ? `${hintId}-${t.id}` : undefined}
            title={reason ?? t.description}
            onClick={() => {
              if (reason) return;
              applyPlotType(t.id, () => useAuxFigureStore.getState().setTernaryOpen(true));
              onClose();
            }}
            style={{
              // The tile holds a glyph AND a label: `.qz-btn`'s fixed control
              // height clipped them over each other (live check), so it grows.
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 6px",
              height: "auto", minHeight: 64,
              opacity: reason ? 0.45 : 1, cursor: "default",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>{t.glyph}</span>
            <span style={{ fontSize: 11 }}>{t.label}</span>
            {reason && <span id={`${hintId}-${t.id}`} hidden>{reason}</span>}
          </button>
        );
      })}
    </div>
  );
}
