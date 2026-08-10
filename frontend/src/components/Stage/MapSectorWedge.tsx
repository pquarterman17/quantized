// Draggable sector-wedge overlay (RSM_CUTS_PLAN item 12) — grows the
// read-only wedge outline (extracted from MapRoiOverlay.tsx in the previous
// commit) into the full interactive control: 4 field-handle markers
// (qMin/qMax radial arcs, phiMin/phiMax angular edges) plus an interior
// rotate, and an INTERACTIVE inline commit bar (preview sparkline +
// Radial/Azimuthal buttons, reusing `roiBarLayout.ts`'s sparkline/
// positioning math — the same helpers MapRoiOverlay.tsx's box/ruler bars
// use, so there is exactly one implementation of each). Same two-layer
// shape as the box/ruler it sits beside: a pointer-transparent SVG plus a
// `qzk-glass` div.
//
// Only ever rendered when `wedge.sector` is non-null — that field is ALREADY
// gated on `cutSpace === "q"` inside `useMapSectorWedge.ts`, so "hide the
// wedge on angular axes" (RSM_CUTS_PLAN item 12) falls out for free: this
// component simply has nothing to draw. The toolbar's arm button is the
// separate "disabled, with the reason visible" affordance (MapToolbar.tsx) —
// division of labour: this file is fully silent when inapplicable, the
// button explains why.

import { Button } from "../primitives";
import type { MapPayload } from "../../lib/mapdata";
import type { RoiSector } from "../../lib/roi";
import { sectorHandlePositions, type SectorField } from "../../lib/roiSector";
import { dataToPx, fmt, plotRect } from "./mapRender";
import { barPosition, sparklinePoints, SPARK_H, SPARK_W } from "./roiBarLayout";
import type { UseMapSectorWedgeState } from "./useMapSectorWedge";

function fmtSector(sector: RoiSector): string {
  return `q ${fmt(sector.qMin)}…${fmt(sector.qMax)}  φ ${fmt(sector.phiMin)}…${fmt(sector.phiMax)}`;
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

const HANDLE_ORDER: readonly SectorField[] = ["qMin", "qMax", "phiMin", "phiMax"];

/** The 4 field handles projected to px, dropping any that fall outside the
 *  plot area (mirrors `MapRoiOverlay.tsx`'s own rect/ruler handle drawing —
 *  a handle off the visible map isn't drawn, but the others still are). */
function handlePx(
  sector: RoiSector,
  project: (x: number, y: number) => [number, number] | null,
): { field: SectorField; x: number; y: number }[] {
  const pos = sectorHandlePositions(sector);
  return HANDLE_ORDER.map((field) => {
    const p = project(pos[field].x, pos[field].y);
    return p ? { field, x: p[0], y: p[1] } : null;
  }).filter((p): p is { field: SectorField; x: number; y: number } => p != null);
}

export interface MapSectorWedgeProps {
  payload: MapPayload;
  w: number;
  h: number;
  wedge: UseMapSectorWedgeState;
}

export default function MapSectorWedge({ payload, w, h, wedge }: MapSectorWedgeProps) {
  const { sector } = wedge;
  if (!sector) return null;

  const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
  const wedgeD = sectorWedgePath(sector, project);
  const handles = handlePx(sector, project);
  const bounds = handles.reduce(
    (b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), y0: Math.min(b.y0, p.y), y1: Math.max(b.y1, p.y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  const hasBounds = handles.length > 0;

  return (
    <>
      {wedgeD && (
        <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
          <path d={wedgeD} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" />
          {handles.map((p) => (
            <rect key={p.field} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="var(--accent)" stroke="var(--surface-0)" />
          ))}
          {handles[0] && (
            <text
              x={handles[0].x}
              y={Math.max(10, bounds.y0 - 6)}
              fontFamily="var(--font-mono)"
              fontSize={10}
              fill="var(--text-dim)"
            >
              {fmtSector(sector)}
            </text>
          )}
        </svg>
      )}

      {hasBounds && (
        <div
          className="qzk-glass qzk-roi-bar"
          style={barPosition(bounds, plotRect(payload, w, h))}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="qzk-roi-bar-row">
            <span className="qzk-roi-bar-label">preview</span>
            <div className="qzk-roi-axis-toggle">
              <button
                className={wedge.previewAxis === "q" ? "active" : ""}
                onClick={() => wedge.setPreviewAxis("q")}
              >
                q
              </button>
              <button
                className={wedge.previewAxis === "phi" ? "active" : ""}
                onClick={() => wedge.setPreviewAxis("phi")}
              >
                φ
              </button>
            </div>
          </div>
          <svg className="qzk-roi-sparkline" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
            {wedge.preview && wedge.preview.x.length > 1 && (
              <polyline
                points={sparklinePoints(wedge.preview, SPARK_W, SPARK_H)}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
              />
            )}
          </svg>
          <div className="qzk-roi-bar-row">
            <Button
              size="sm"
              variant="primary"
              disabled={wedge.busy}
              onClick={wedge.runRadial}
              title="Radial |Q| profile within this sector — POST /api/rsm/sector, lands as a dataset"
            >
              {wedge.busy ? "Working…" : "Radial"}
            </Button>
            <Button
              size="sm"
              disabled={wedge.busy}
              onClick={wedge.runAzimuthal}
              title="Azimuthal (chi) profile within this annulus — POST /api/rsm/chi-profile, lands as a dataset"
            >
              Azimuthal
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
