// Box-ROI overlay for the 2-D map (RSM_CUTS_PLAN item 6) — two layers over
// the canvas:
//  (a) a pointer-transparent SVG: the box itself (accent rect + 8 six-px
//      handles + a JetBrains-Mono bounds readout) and, when the displayed
//      axes are Q and a sector is configured in the ROI cuts panel, the
//      true-polar sector as an annular wedge outline.
//  (b) the INTERACTIVE inline commit bar — a `qzk-glass` div positioned
//      with `rectToPx`/`dataToPx` (the SAME projector the canvas and the
//      SVG layer use, never re-derived): a "preview"-labelled sparkline
//      (client-only, lib/roiMath.ts), a live N/∫I readout, and the ∫x / ∫y
//      / Stats buttons that turn one drag + one click into a library
//      dataset. This is the deliverable the ROI panel is explicitly NOT
//      required for.
//
// The sector-wedge preview reads `workshops/roicuts/useRoiCuts` purely for
// its exported `sectorPreview` (a read-only consumption of an already-built
// hook — this file never imports/edits anything else from that workshop).
// KNOWN v1 WART: that hook keeps its sector fields as its own component-
// local state, so a second call here does not see edits made in an actually
// OPEN RoiCutsPanel — it echoes that hook's own dataset-derived defaults.
// Same category of wart as MapStageProps' documented "two map windows share
// singleton state" note; not a functional problem for the wedge's purpose
// (a rough visual of "this is roughly the sector shape"), just not
// live-synced to a second, independent instance of the same hook.

import { Button } from "../primitives";
import { useRoiCuts } from "../workshops/roicuts/useRoiCuts";
import type { CutSpace } from "../../lib/mapcuts";
import type { MapPayload } from "../../lib/mapdata";
import { handlePositions, rectToPx, type RoiRect, type RoiSector } from "../../lib/roi";
import type { RoiBoxStats, RoiProfile } from "../../lib/roiMath";
import type { BoxStats } from "../../lib/api/rsm";
import { dataToPx, fmt, plotRect } from "./mapRender";

const SPARK_W = 176;
const SPARK_H = 30;
// Matches `.qzk-roi-bar`'s fixed CSS width (shell.css) and an estimate of its
// no-stats-shown height — the clamp below only needs to be close (the Stats
// readout, when it appears, is allowed to run slightly past this estimate;
// it still stays inside the plot rect on the axis that matters, horizontal).
const BAR_W = 216;
const BAR_H = 140;

function fmtBounds(rect: RoiRect): string {
  return `${fmt(rect.x0)}…${fmt(rect.x1)}, ${fmt(rect.y0)}…${fmt(rect.y1)}`;
}

function sparklinePoints(profile: RoiProfile, w: number, h: number): string {
  const n = profile.intensity.length;
  if (n < 2) return "";
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = profile.intensity[i]!;
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "";
  const span = hi - lo || 1;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = profile.intensity[i]!;
    const x = (i / (n - 1)) * w;
    const y = Number.isFinite(v) ? h - ((v - lo) / span) * h : h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Annular-wedge outline (qMin..qMax radii, phiMin..phiMax azimuth) as an
 *  SVG path, sampled at 3° steps and projected through `project` — no trig
 *  shortcut for the rotation an affine px projection introduces (same
 *  reasoning `lib/roi.ts::rulerCorners`'s doc gives for the cut ruler). */
function sectorWedgePath(sector: RoiSector, project: (x: number, y: number) => [number, number] | null): string | null {
  const span = (((sector.phiMax - sector.phiMin) % 360) + 360) % 360 || 360;
  const steps = Math.max(2, Math.min(120, Math.round(span / 3)));
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const rad = ((sector.phiMin + (span * i) / steps) * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const po = project(sector.qMax * c, sector.qMax * s);
    const pi = project(sector.qMin * c, sector.qMin * s);
    if (po) outer.push(po);
    if (pi) inner.push(pi);
  }
  if (outer.length < 2 || inner.length < 2) return null;
  const d = [
    `M ${outer[0]![0]} ${outer[0]![1]}`,
    ...outer.slice(1).map((p) => `L ${p[0]} ${p[1]}`),
    ...inner.reverse().map((p) => `L ${p[0]} ${p[1]}`),
    "Z",
  ];
  return d.join(" ");
}

/** Keep the inline bar clear of the box (below it, or above when that would
 *  run off the bottom) and inside the plot rect on both axes. */
function barPosition(
  rectPx: { x0: number; y0: number; x1: number; y1: number },
  plot: { x: number; y: number; w: number; h: number },
): { left: number; top: number } {
  let top = rectPx.y1 + 8;
  if (top + BAR_H > plot.y + plot.h) top = rectPx.y0 - BAR_H - 8;
  const left = Math.min(Math.max(rectPx.x0, plot.x), plot.x + Math.max(0, plot.w - BAR_W));
  return { left, top: Math.min(Math.max(top, plot.y), plot.y + Math.max(0, plot.h - BAR_H)) };
}

export interface MapRoiOverlayProps {
  payload: MapPayload;
  w: number;
  h: number;
  cutSpace: CutSpace | null;
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
}

export default function MapRoiOverlay(props: MapRoiOverlayProps) {
  const {
    payload,
    w,
    h,
    cutSpace,
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
  } = props;
  // Read-only echo of the panel's sector card — see this file's header wart note.
  const sectorPreview = useRoiCuts().sectorPreview;

  const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
  const rectPx = rect ? rectToPx(rect, project) : null;
  const wedgeD = cutSpace === "q" && sectorPreview ? sectorWedgePath(sectorPreview, project) : null;

  return (
    <>
      {(rectPx || wedgeD) && (
        <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
          {wedgeD && (
            <path d={wedgeD} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" />
          )}
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
              <text x={rectPx.x0} y={Math.max(10, rectPx.y0 - 6)} fontFamily="var(--font-mono)" fontSize={10} fill="var(--text-dim)">
                {fmtBounds(rect)}
              </text>
            </g>
          )}
        </svg>
      )}

      {rect && rectPx && (
        <div
          className="qzk-glass qzk-roi-bar"
          style={barPosition(rectPx, plotRect(payload, w, h))}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="qzk-roi-bar-row">
            <span className="qzk-roi-bar-label">preview</span>
            <div className="qzk-roi-axis-toggle">
              <button className={previewAxis === "x" ? "active" : ""} onClick={() => onPreviewAxisChange("x")}>
                x
              </button>
              <button className={previewAxis === "y" ? "active" : ""} onClick={() => onPreviewAxisChange("y")}>
                y
              </button>
            </div>
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
          <div className="qzk-roi-bar-row">
            <Button size="sm" disabled={landingBusy} onClick={() => onIntegrate("x")} title="Integrate onto x, land as a new dataset">
              ∫x
            </Button>
            <Button size="sm" disabled={landingBusy} onClick={() => onIntegrate("y")} title="Integrate onto y, land as a new dataset">
              ∫y
            </Button>
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
        </div>
      )}
    </>
  );
}
