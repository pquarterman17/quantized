// Multi-panel plot, four modes sharing one host (all state + the imperative
// uPlot-instance render effect live in `useMultiPanelStage.ts` — this file is
// a thin view, the `useStatStage`/`StatStage.tsx` precedent):
//  1) Plain per-channel stack: each plotted channel of the ACTIVE dataset
//     gets its own vertically-stacked uPlot panel sharing the x-axis.
//     Box-zoom/pan on any panel syncs the x-range to the others (setScale
//     hook), and the cursor crosshair syncs via uPlot's sync group. Only the
//     bottom panel shows x tick labels so the panels align.
//  2) Spatial multi-panel (decode-plan #36): `store.spatialPanels`, set by
//     `applyOriginFigure` when a multi-layer Origin figure's layers all
//     resolve, arranges EACH panel's OWN dataset + channel selection + fixed
//     axis state in a CSS grid per the source page's layout
//     (`lib/originPanels.computePanelLayout`). Panels are independent — no
//     x-sync, since they may plot entirely unrelated datasets/quantities.
//     Each panel also draws its own Origin Y-error whiskers
//     (`lib/errorbars.buildErrorColumns`, item A — a "Y-error"-designated
//     column like PNR.opj's `dSA` used to render as a spurious series).
//  3) Facet grid (gap #21 residual): `store.facetPanels`, set by the
//     `facetByColumn` action, arranges one small-multiples panel per distinct
//     level of a chosen column in a sqrt-balanced CSS grid
//     (`lib/multipanel.facetGridSize`). Unlike spatial panels, every facet
//     panel is a ROW-FILTERED SLICE of the SAME dataset/channels — already
//     materialized as a `PlotPayload` by `lib/facet.facetPayloads`, so this
//     mode needs no fetch — and shares ONE x-domain across all panels
//     (`lib/facet.sharedXDomain`), with box-zoom/pan sync like the plain
//     stack (same idiom, since the x AXIS means the same thing in every
//     panel). Each panel's uPlot `title` shows its facet level.
//  4) Paneled x-breaks (gap #21 LAST residual): `store.breakPanels`, set by
//     the `breakAtGaps` action, splits ONE series at large x-gaps
//     (`lib/facet.suggestBreaks` or an explicit override) into adjacent
//     panels laid out in a single row (`lib/multipanel.breakPanelWidths`),
//     with a diagonal break-glyph seam between each pair. Unlike facet, break
//     panels each keep their OWN local x-range but share ONE y-domain
//     (`lib/facet.sharedYDomain`) — an honest axis break only elides x.
//  Precedence when more than one is populated (the store keeps them mutually
//  exclusive, but the hook renders defensively): spatial > break > facet >
//  plain stack.
// Self-contained — fetches its own series; overlays/waterfall stay single-view.

import "uplot/dist/uPlot.min.css";

import { useApp } from "../../store/useApp";
import { useMultiPanelStage } from "./useMultiPanelStage";

export default function MultiPanelStage() {
  const setStackMode = useApp((s) => s.setStackMode);
  const { hostRef, hostStyle, readout, tool } = useMultiPanelStage();

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={hostStyle} />
      <div className="qzk-glass qzk-float-tools">
        <button
          className="qzk-tool-btn active"
          title="Back to a single overlaid plot"
          onClick={() => setStackMode(false)}
        >
          ▤
        </button>
      </div>
      {tool === "cursor" && readout && (
        <div className="qzk-glass qzk-readout">
          <div style={{ color: "var(--text-dim)" }}>x = {readout.x.toPrecision(5)}</div>
          {readout.rows.map((r, i) => (
            <div key={`${r.label}-${i}`} style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
              <span>{r.label || "y"}</span>
              <span>{r.y.toPrecision(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
