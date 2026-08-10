// Sector-wedge PREVIEW path — extracted out of MapRoiOverlay.tsx
// (RSM_CUTS_PLAN item 12's "pay first" step: that file was 383/400, 17
// lines from its own 400-line ceiling, so the wedge-DRAG feature landing in
// the next commit needs this extraction done first, same "toolbar extracted
// before the ROI wiring landed" convention item 6 established). Pure
// relocation, no behaviour change: still a read-only echo of the caller's
// `sectorPreview`, still gated by the caller on `cutSpace === "q"`.

import type { RoiSector } from "../../lib/roi";

/** Annular-wedge outline (qMin..qMax radii, phiMin..phiMax azimuth) as an
 *  SVG path, sampled at 3° steps and projected through `project` — no trig
 *  shortcut for the rotation an affine px projection introduces (same
 *  reasoning `lib/roi.ts::rulerCorners`'s doc gives for the cut ruler). */
export function sectorWedgePath(sector: RoiSector, project: (x: number, y: number) => [number, number] | null): string | null {
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

export interface MapSectorWedgeProps {
  sector: RoiSector | null;
  project: (x: number, y: number) => [number, number] | null;
}

export default function MapSectorWedge({ sector, project }: MapSectorWedgeProps) {
  if (!sector) return null;
  const d = sectorWedgePath(sector, project);
  if (!d) return null;
  return (
    <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
      <path d={d} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" />
    </svg>
  );
}
