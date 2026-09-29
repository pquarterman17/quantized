// Graph Builder live mini-preview. box/violin/bar reuse the #16/#20 stat
// renderer (Stage/statRender.ts); scatter/line paint a compact Canvas2D
// scatter/line from the specToRender PlotPayload — one panel normally, or a
// small-multiples GRID when the spec's facet zone is set (#21 faceting,
// lib/facet.facetPayloads; see plotspec.ts's `SpecRender.facets`). box/bar
// facet the SAME way (GUI_INTERACTION #11 residual) but render differently:
// the xy grid paints every panel onto ONE shared canvas (`drawFacetGrid`),
// while box/bar tile N independent `StatStageCanvas`es (`FacetStatGrid`
// below) — mirroring the live Stat Stage's own facet grid so the two stay
// visually consistent. A "message" render shows its text instead. The canvas
// is invisible to jsdom (no layout / 2-D context), so the painters
// (./previewCanvas) are eyeball-verified — the grammar they draw from is
// unit-tested in lib/plotspec + lib/facet + lib/plotEncoding.
//
// P1.4 encodings (Color-by / Symbol-by / legend source): an encoded xy render
// arrives with `encoded` (lib/plotEncoding.encodeSpec) — its per-series
// `styles` go to the painter, and its `legend` entries render through the
// existing read-only legend (Stage/SpatialPanelLegend, LegendSample swatches),
// so the key shows the same colour and glyph the canvas draws.
//
// Categorical marks (JMP_GAP J5 residual, closed 2026-09-29): given the live
// `spec`, box / violin / bar draw the window's `PlotView.statMarks` for that
// mode — raw points on ORIGINAL rows, summary marker, error bars — flat and
// per facet panel, as the Stat Stage it sends to does (`./previewMarks`).

import { useEffect, useMemo, useRef } from "react";

import type { EncodedSpec } from "../../../lib/plotEncoding";
import type { PlotSpec, SpecRender } from "../../../lib/plotspec";
import type { SeriesStyle } from "../../../lib/types";
import type { Accent, Theme } from "../../../store/useApp";
import { useApp } from "../../../store/useApp";
import SpatialPanelLegend from "../../Stage/SpatialPanelLegend";
import StatStageCanvas from "../../Stage/StatStageCanvas";
import { draw as drawStat, type StatDrawData } from "../../Stage/statRender";
import { drawFacetGrid, drawXY } from "./previewCanvas";
import { previewStatDraws, type PreviewStatDraws } from "./previewMarks";

/** The single-panel canvas host (xy incl. its own facet grid, flat box/bar,
 *  message). Owns the ONE canvas + its paint effect — unchanged from before
 *  #11's box/bar facet grid split it out of the default export. */
function CanvasHost({
  render,
  stat,
  styles,
  theme,
  accent,
}: {
  render: SpecRender;
  /** The box / bar draw (`previewStatDraws`), marks included. */
  stat: StatDrawData | null;
  styles?: readonly SeriesStyle[];
  theme: Theme;
  accent: Accent;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => {
      if (render.kind === "xy") {
        const showMarkers = render.showMarkers ?? false;
        const stepMode = render.stepMode ?? "post";
        if (render.facets && render.facets.length > 0) {
          drawFacetGrid(canvas, host, render.facets, render.mark, showMarkers, stepMode);
        } else {
          drawXY(canvas, host, render.payload, render.mark, showMarkers, stepMode, render.errorSpans, styles);
        }
      } else if (stat) {
        drawStat(canvas, host, stat);
      } else {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    paint();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
  }, [render, stat, styles, theme, accent]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

/** A CSS grid of independent, DOM-captioned `StatStageCanvas` cells — the
 *  shared tiling both box-facets and bar-facets use below (#11). Mirrors
 *  StatStage.tsx's own facet grid so the builder preview and the live stage
 *  read the same. */
function FacetCellGrid({
  cells,
  theme,
  accent,
}: {
  cells: { label: string; draw: StatDrawData }[];
  theme: Theme;
  accent: Accent;
}) {
  const cols = Math.ceil(Math.sqrt(cells.length));
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gap: 4, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cells.map((c) => (
        <div key={c.label} style={{ position: "relative", display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--text-dim)",
              padding: "0 2px",
            }}
          >
            {c.label}
          </div>
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <StatStageCanvas data={c.draw} theme={theme} accent={accent} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GraphPreview({
  render,
  encoded,
  spec = null,
}: {
  render: SpecRender;
  encoded?: EncodedSpec | null;
  /** The live spec: box / violin / bar then draw the window's marks. */
  spec?: PlotSpec | null;
}) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const datasets = useApp((s) => s.datasets);
  const statMarks = useApp((s) => s.statMarks);
  // Faceted box/bar (#11): one small `StatStageCanvas` per facet level instead
  // of the single shared canvas `CanvasHost` paints.
  const stat = useMemo<PreviewStatDraws>(
    () => previewStatDraws(render, spec, datasets, statMarks ?? {}),
    [render, spec, datasets, statMarks],
  );

  return (
    <div className="qzk-graph-preview">
      {stat.facets && stat.facets.length > 0 ? (
        <FacetCellGrid cells={stat.facets} theme={theme} accent={accent} />
      ) : (
        <CanvasHost render={render} stat={stat.flat} styles={encoded?.styles} theme={theme} accent={accent} />
      )}
      {render.kind === "xy" && encoded && encoded.legend.length > 0 && <SpatialPanelLegend entries={encoded.legend} />}
      {render.kind === "message" && (
        <div className={`qzk-graph-preview-msg${render.tone === "note" ? " note" : ""}`}>
          {render.message}
        </div>
      )}
      {render.kind === "box" && render.violin && (
        <div className="qzk-graph-preview-approx">violin preview shows box · KDE renders in the editable plot</div>
      )}
    </div>
  );
}
