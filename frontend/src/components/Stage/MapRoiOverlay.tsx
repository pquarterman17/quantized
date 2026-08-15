// Box-ROI + cut-ruler overlay for the 2-D map (RSM_CUTS_PLAN items 6 + 7) —
// two layers over the canvas:
//  (a) a pointer-transparent SVG: the box (accent rect + 8 six-px handles +
//      a JetBrains-Mono bounds readout), and the cut ruler (rotated outline +
//      4 six-px handles [2 ends, 2 width] + a JetBrains-Mono angle/length/
//      width readout — item 7).
//  (b) the INTERACTIVE inline commit bar — a `qzk-glass` div positioned
//      with `rectToPx`/`rulerCorners`+`dataToPx` (the SAME projector the
//      canvas and the SVG layer use, never re-derived): a "preview"-labelled
//      sparkline (client-only, lib/roiMath.ts), a live N/∫I readout, and the
//      two ∫ buttons + Stats that turn one drag + one click into a library
//      dataset. This is the deliverable the ROI panel is explicitly NOT
//      required for. The box and the ruler each get their own bar (positioned
//      off their own bounds), sharing ONE `CommitBar` body component — the two
//      tools commit through the identical preview/N/∫I/∫/Stats vocabulary,
//      box_cut vs its rotated (rulerBoxBody) form only. What the two ∫ and
//      toggle buttons are LABELLED differs, though, and that difference is
//      real: see `roiAxisNames.ts`.
//
// The sector wedge (item 12: draggable true-polar sector, shown when the
// displayed axes are Q) is its OWN component, `MapSectorWedge.tsx`, driven
// by its OWN gesture hook (`useMapSectorWedge.ts`) rather than this file
// reading `useRoiCuts()` directly — that hook now owns the `cutSpace==="q"`
// gate and the sector-vs-null derivation internally, so this file only needs
// to thread the hook's grouped state through as a prop (`wedgeState`, same
// convention as `rulerState`). `sparklinePoints`/`barPosition`/
// `boundsOfPoints` (the bar-layout math both files need) live in
// `roiBarLayout.ts`, extracted in the prior commit alongside the wedge's
// own split so neither file re-derives them.

import { Button } from "../primitives";
import type { MapPayload } from "../../lib/mapdata";
import { handlePositions, rectToPx, rulerCorners, type RoiRect, type RoiRuler } from "../../lib/roi";
import type { RoiBoxStats, RoiProfile } from "../../lib/roiMath";
import type { BoxStats } from "../../lib/api/rsm";
import { dataToPx, fmt, plotRect } from "./mapRender";
import MapSectorWedge from "./MapSectorWedge";
import {
  boxAxes,
  integrateTitle,
  previewTitle,
  rulerAxes,
  type CollapseAxes,
} from "./roiAxisNames";
import { barPosition, boundsOfPoints, sparklinePoints, SPARK_H, SPARK_W } from "./roiBarLayout";
import type { UseMapRulerState } from "./useMapRuler";
import type { UseMapSectorWedgeState } from "./useMapSectorWedge";

/** The commit bar must not take the pointer while its own shape is being
 *  dragged.
 *
 *  The bar is a sibling DIV positioned over the canvas, and it appears the
 *  instant a zero-size box exists — i.e. right under the cursor at mouse-down.
 *  A canvas cannot have DOM children, so the moment the pointer crosses onto
 *  the bar the canvas fires `onMouseLeave`, which routes to the tool's
 *  `onLeave` → `cancelDrag()` → the shape reverts to its pre-gesture value.
 *  Measured: drawing from (560, 390) put the bar at x 560..776, y 398..518 —
 *  directly across the drag path — so the box vanished mid-drag and both
 *  drawing and resizing "did not work" for any gesture heading its way.
 *  Reported from a real session as exactly that.
 *
 *  Going pointer-transparent for the duration keeps the pointer logically on
 *  the canvas, so no spurious leave fires. The bar has nothing to click
 *  mid-drag anyway; it becomes interactive again the moment the drag ends. */
function barPointerEvents(dragging: boolean): "none" | undefined {
  return dragging ? "none" : undefined;
}

/** The box's extent, each range prefixed with the axis it belongs to. The
 *  unnamed "0.20…1.80, 0.20…1.80" it replaces made the reader map position to
 *  meaning by eye; the names come from `boxAxes`, so this readout, the bar's
 *  controls and the canvas axis titles all say the same word. Units are left
 *  to the tooltips — this text sits over the data and has no box to wrap in. */
function fmtBounds(rect: RoiRect, axes: CollapseAxes): string {
  return `${axes.x.name} ${fmt(rect.x0)}…${fmt(rect.x1)}   ${axes.y.name} ${fmt(rect.y0)}…${fmt(rect.y1)}`;
}

/** Angle/length/width readout for the ruler — the "angle readout in
 *  JetBrains Mono" item 7 asks for, extended with the length/width a user
 *  needs to reproduce the cut numerically. */
function fmtRuler(ruler: RoiRuler): string {
  return `${fmt(ruler.angle)}° L=${fmt(ruler.length)} W=${fmt(ruler.width)}`;
}

/** `rulerCorners(ruler)` projected to px, or null if any corner falls
 *  outside the plot area — mirrors `useMapRuler.ts`'s own private helper
 *  (kept separate: that one drives hit-testing, this one only draws). */
function rulerCornersPx(
  ruler: RoiRuler,
  project: (x: number, y: number) => [number, number] | null,
): { x: number; y: number }[] | null {
  const pts = rulerCorners(ruler).map((c) => project(c.x, c.y));
  if (pts.some((p) => !p)) return null;
  return pts.map((p) => ({ x: p![0], y: p![1] }));
}

/** The ruler's 4 named-handle positions (end 0/1, width 0/1) as consecutive-
 *  corner midpoints — same derivation `lib/roi.ts::classifyRulerHit` uses
 *  for hit-testing, mirrored here purely for drawing the handle glyphs. */
function rulerHandlePositions(cornersPx: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const [c0, c1, c2, c3] = cornersPx;
  if (!c0 || !c1 || !c2 || !c3) return [];
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return [mid(c0, c1), mid(c2, c3), mid(c1, c2), mid(c3, c0)];
}

interface CommitBarProps {
  preview: RoiProfile | null;
  previewAxis: "x" | "y";
  onPreviewAxisChange: (axis: "x" | "y") => void;
  previewStats: RoiBoxStats | null;
  onIntegrate: (axis: "x" | "y") => void;
  landingBusy: boolean;
  onStats: () => void;
  statsBusy: boolean;
  apiStats: BoxStats | null;
  statsError: string | null;
  onClearStats: () => void;
  /** Remove this ROI outright. Until this button existed, Delete/Backspace on
   *  a FOCUSED map was the only way — and the map is only focusable once a
   *  shape exists, so if focus sat anywhere else (a Library row, say) the
   *  keystroke fell through to the global shortcut and removed the DATASET
   *  instead. Reported from a real session. The keystroke still works; this
   *  is the discoverable path that does not depend on where focus happens to
   *  be. Sits in the header row, deliberately away from the ∫/Stats buttons,
   *  so it is not mis-hit while committing. */
  onRemove: () => void;
  removeLabel: string;
  /** What this shape's two collapse axes are actually called — the map's own
   *  axes for the box, the ruler's own frame for the ruler. See
   *  `roiAxisNames.ts` for why those are not the same thing. */
  axes: CollapseAxes;
}

/** Shared inline-bar body for both the box and the ruler — same preview/N/
 *  ∫I/∫/Stats vocabulary, only the positioning (caller), the axis NAMES
 *  (`axes`, see roiAxisNames.ts) and the request shape underneath
 *  `onIntegrate`/`onStats` (box_cut vs rulerBoxBody) differ. */
function CommitBar(props: CommitBarProps) {
  const { preview, previewAxis, onPreviewAxisChange, previewStats, onIntegrate, landingBusy, onStats, statsBusy, apiStats, statsError, onClearStats, onRemove, removeLabel, axes } = props;
  return (
    <>
      <div className="qzk-roi-bar-row">
        <span className="qzk-roi-bar-label">preview</span>
        <div className="qzk-roi-axis-toggle">
          <button className={previewAxis === "x" ? "active" : ""} title={previewTitle(axes.x)} onClick={() => onPreviewAxisChange("x")}>
            {axes.x.name}
          </button>
          <button className={previewAxis === "y" ? "active" : ""} title={previewTitle(axes.y)} onClick={() => onPreviewAxisChange("y")}>
            {axes.y.name}
          </button>
        </div>
        <button className="qzk-chip-reset" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
          ✕
        </button>
      </div>
      <svg className="qzk-roi-sparkline" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
        {preview && preview.x.length > 1 && (
          <polyline points={sparklinePoints(preview, SPARK_W, SPARK_H)} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        )}
      </svg>
      <div className="qzk-roi-bar-row qzk-roi-bar-readout">
        <span>N</span>
        <span>{previewStats ? previewStats.n_points : "—"}</span>
        <span>∫I</span>
        <span>{previewStats ? fmt(previewStats.integrated_intensity) : "—"}</span>
      </div>
      {/* The two ∫ buttons get a row to themselves: named axes ("∫ 2Theta")
          do not fit three-to-a-row in a 216 px bar the way "∫x" did, and the
          name is the whole point of the change. */}
      <div className="qzk-roi-bar-row">
        <Button size="sm" disabled={landingBusy} onClick={() => onIntegrate("x")} title={integrateTitle(axes.x)}>
          {`∫ ${axes.x.name}`}
        </Button>
        <Button size="sm" disabled={landingBusy} onClick={() => onIntegrate("y")} title={integrateTitle(axes.y)}>
          {`∫ ${axes.y.name}`}
        </Button>
      </div>
      <div className="qzk-roi-bar-row">
        <Button size="sm" disabled={statsBusy} onClick={onStats} title="Fetch box_stats from the backend">
          {statsBusy ? "Stats…" : "Stats"}
        </Button>
      </div>
      {apiStats && (
        <div className="qzk-roi-bar-stats">
          <span>∫I</span>
          <strong>{fmt(apiStats.integrated_intensity)}</strong>
          <span>centroid</span>
          <strong>
            {fmt(apiStats.centroid_x)}, {fmt(apiStats.centroid_y)}
          </strong>
          <span>peak</span>
          <strong>
            {fmt(apiStats.peak_x)}, {fmt(apiStats.peak_y)}
          </strong>
          <span>N</span>
          <strong>{apiStats.n_points}</strong>
          <button className="qzk-chip-reset" title="Clear" onClick={onClearStats}>
            ×
          </button>
        </div>
      )}
      {statsError && <div className="qzk-roi-bar-error">{statsError}</div>}
    </>
  );
}

export interface MapRoiOverlayProps {
  payload: MapPayload;
  w: number;
  h: number;
  rect: RoiRect | null;
  preview: RoiProfile | null;
  previewAxis: "x" | "y";
  onPreviewAxisChange: (axis: "x" | "y") => void;
  previewStats: RoiBoxStats | null;
  onIntegrate: (axis: "x" | "y") => void;
  landingBusy: boolean;
  onStats: () => void;
  statsBusy: boolean;
  apiStats: BoxStats | null;
  statsError: string | null;
  onClearStats: () => void;
  /** Remove the box — see CommitBarProps.onRemove for why a button exists. */
  onRemove: () => void;
  /** Is a box gesture in flight? The bar goes pointer-transparent while it is
   *  — see the `barPointerEvents` note below. */
  dragging: boolean;
  /** The cut-ruler hook's full state (RSM_CUTS_PLAN item 7) — passed as one
   *  grouped object (unlike the box's flattened props above) so MapStage.tsx
   *  only needs one line to wire it, buying back headroom on its own
   *  400-line ceiling for the gesture-routing code that item needed. */
  rulerState: UseMapRulerState;
  /** The sector-wedge hook's full state (RSM_CUTS_PLAN item 12) — same
   *  grouped-object convention as `rulerState`, for the same reason. */
  wedgeState: UseMapSectorWedgeState;
}

export default function MapRoiOverlay(props: MapRoiOverlayProps) {
  const {
    payload,
    w,
    h,
    rect,
    preview,
    previewAxis,
    onPreviewAxisChange,
    previewStats,
    onIntegrate,
    landingBusy,
    onStats,
    statsBusy,
    apiStats,
    statsError,
    onClearStats,
    onRemove,
    dragging,
    rulerState,
    wedgeState,
  } = props;

  const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
  const rectPx = rect ? rectToPx(rect, project) : null;
  const ruler = rulerState.ruler;
  const rulerPx = ruler ? rulerCornersPx(ruler, project) : null;
  // Derived here rather than threaded in from MapStage: both inputs (the
  // payload and the ruler's angle) are already in hand, so naming stays a
  // presentation detail of the bar instead of another prop to keep in sync.
  const boxNames = boxAxes(payload);
  const rulerNames = rulerAxes(payload, ruler?.angle ?? 0);

  return (
    <>
      {(rectPx || rulerPx) && (
        <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
          {rectPx && rect && (
            <g>
              <rect
                x={rectPx.x0}
                y={rectPx.y0}
                width={rectPx.x1 - rectPx.x0}
                height={rectPx.y1 - rectPx.y0}
                fill="var(--accent-soft)"
                stroke="var(--accent)"
                strokeWidth={1.5}
              />
              {handlePositions(rectPx).map((p, i) => (
                <rect key={i} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="var(--accent)" stroke="var(--surface-0)" />
              ))}
              <text className="qzk-roi-readout" x={rectPx.x0} y={Math.max(10, rectPx.y0 - 6)}>
                {fmtBounds(rect, boxNames)}
              </text>
            </g>
          )}
          {rulerPx && ruler && (
            <g>
              <polygon
                points={rulerPx.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="var(--accent-soft)"
                stroke="var(--accent)"
                strokeWidth={1.5}
              />
              {rulerHandlePositions(rulerPx).map((p, i) => (
                <rect key={i} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="var(--accent)" stroke="var(--surface-0)" />
              ))}
              <text className="qzk-roi-readout" x={rulerPx[0]!.x} y={Math.max(10, rulerPx[0]!.y - 6)}>
                {fmtRuler(ruler)}
              </text>
            </g>
          )}
        </svg>
      )}

      <MapSectorWedge payload={payload} w={w} h={h} wedge={wedgeState} />

      {rect && rectPx && (
        <div
          className="qzk-glass qzk-roi-bar"
          style={{ ...barPosition(rectPx, plotRect(payload, w, h)), pointerEvents: barPointerEvents(dragging) }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          // Retrospective-audit P1 fix: the bar's buttons (axis toggle, ✕
          // remove, Clear) sit OUTSIDE the canvas that owns the ROI/ruler
          // keydown, so Delete/Backspace/arrows on a Tab-focused button
          // leaked to the global handlers and removed/switched the DATASET.
          // No-op consume — same contract as the canvas's own keydown.
          onKeyDown={(e) => {
            if (["Delete", "Backspace", "ArrowUp", "ArrowDown"].includes(e.key)) e.preventDefault();
          }}
        >
          <CommitBar
            preview={preview}
            previewAxis={previewAxis}
            onPreviewAxisChange={onPreviewAxisChange}
            previewStats={previewStats}
            onIntegrate={onIntegrate}
            landingBusy={landingBusy}
            onStats={onStats}
            statsBusy={statsBusy}
            apiStats={apiStats}
            statsError={statsError}
            onClearStats={onClearStats}
            onRemove={onRemove}
            removeLabel="Remove this box"
            axes={boxNames}
          />
        </div>
      )}

      {ruler && rulerPx && (
        <div
          className="qzk-glass qzk-roi-bar"
          style={{ ...barPosition(boundsOfPoints(rulerPx), plotRect(payload, w, h)), pointerEvents: barPointerEvents(rulerState.dragging) }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          // Same retrospective-audit consume as the ROI bar above.
          onKeyDown={(e) => {
            if (["Delete", "Backspace", "ArrowUp", "ArrowDown"].includes(e.key)) e.preventDefault();
          }}
        >
          <CommitBar
            preview={rulerState.preview}
            previewAxis={rulerState.previewAxis}
            onPreviewAxisChange={rulerState.setPreviewAxis}
            previewStats={rulerState.previewStats}
            onIntegrate={rulerState.commitIntegrate}
            landingBusy={rulerState.landingBusy}
            onStats={rulerState.commitStats}
            statsBusy={rulerState.statsBusy}
            apiStats={rulerState.apiStats}
            statsError={rulerState.statsError}
            onClearStats={rulerState.clearStats}
            onRemove={rulerState.remove}
            removeLabel="Remove this ruler"
            axes={rulerNames}
          />
        </div>
      )}
    </>
  );
}
