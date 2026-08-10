// Pure, DOM-free geometry for the draggable sector wedge (RSM_CUTS_PLAN item
// 12) — hit-testing and drag math for RoiSector (lib/roi.ts), kept as its
// OWN module rather than added to lib/roi.ts: that file is PINNED at 638
// lines (TS_MODULE_PINS, architecture.test.ts) with no slack, and the task
// notes for this item explicitly name a new pure module as the sanctioned
// alternative — not a reason to touch the pin.
//
// The wedge is always about the reciprocal-lattice ORIGIN (Qx=0, Qz=0) — the
// same convention sector_profile/chi_profile use (phi = atan2(Qz,Qx)) and
// MapRoiOverlay.tsx's existing sectorWedgePath already draws by. It is only
// ever shown/draggable over a Q-space view (RSM_CUTS_PLAN's Resolved
// decisions polar-space rule, branch i), and a Q view LOCKS equal aspect
// (lib/mapAspect.ts, item 17) — the data<->px scale is the SAME uniform
// factor on both axes. That is what makes a genuinely polar hit-test
// possible without ever projecting a point: every distance below is computed
// in DATA units, then converted to an approximate px distance by ONE scalar
// multiply (`pxPerUnit`) — exact for a Euclidean distance under a uniform
// (isotropic) scale, which is exactly what an equal-aspect Q view is.
//
// Four fields, four "handles" (this item's brief): the qMin/qMax RADIAL ARCS
// and the phiMin/phiMax ANGULAR EDGES. Each is hit-testable anywhere along
// its own length (not just a fixed marker point) — an arc via
// `nearestArcPoint`'s clamp-to-span, an edge via the SAME
// `pointToSegmentDistance` (shapeHit.ts) the box/ruler already reuse for
// their own straight edges. `classifyRoiHit`'s "handle beats edge beats
// interior" precedence collapses to "nearest of the four boundary elements
// beats the interior" here — unlike a rect, a sector's boundary elements ARE
// its handles (there is no coarser corner/edge distinction to make), so
// nearest-wins among the four IS the full precedence order.

import { pointToSegmentDistance } from "./shapeHit";
import type { RoiSector } from "./roi";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Python's `%` (always non-negative for a positive divisor) — mirrors
 *  `lib/roiMath.ts`'s own private `pymod`. Not imported from there: that
 *  module is ALSO pinned (664) with no slack, and this one-line function is
 *  cheaper to restate than to fight a second pin for. */
export function pymod(x: number, n: number): number {
  const r = x % n;
  return r < 0 ? r + n : r;
}

/** The sector's own angular span, `(0, 360]` — a zero-width phiMin===phiMax
 *  is treated as a FULL CIRCLE, mirroring `_rsm_grid.wrap_mask`/item 21's
 *  MATLAB-parity convention (the same formula `roiMath.ts`'s `wrapMask`/
 *  `polarBinned` use). */
export function sectorSpan(sector: RoiSector): number {
  return pymod(sector.phiMax - sector.phiMin, 360) || 360;
}

/** A point at radius `r`, azimuth `phiDeg` (DATA coords, origin-centred) —
 *  shared by `sectorHandlePositions` (drawing) and the phiMin/phiMax edge
 *  hit-test (segment endpoints) so they can never disagree, mirroring how
 *  `lib/roi.ts::rulerCorners` is shared by drawing and hit-testing. */
function polarPoint(r: number, phiDeg: number): { x: number; y: number } {
  const rad = phiDeg * DEG2RAD;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

/** Nearest point (DATA coords) on the ARC of radius `r` spanning
 *  [phiMinDeg, phiMinDeg+span] to a point at azimuth `phiDeg` — clamps to
 *  the arc's own endpoints when `phiDeg` falls outside its span, the curved
 *  analogue of `pointToSegmentDistance`'s clamp-to-segment-ends. */
function nearestArcPoint(r: number, phiMinDeg: number, span: number, phiDeg: number): { x: number; y: number } {
  const rebased = pymod(phiDeg - phiMinDeg, 360);
  const clampedDeg = phiMinDeg + Math.min(Math.max(rebased, 0), span);
  return polarPoint(r, clampedDeg);
}

/** The 4 field handles' DATA-space draw positions: qMin/qMax at the
 *  sector's angular MIDPOINT (a representative point along that arc),
 *  phiMin/phiMax at the RADIAL midpoint (a representative point along that
 *  edge) — mirrors `lib/roi.ts::rulerHandlePositions`'s "one representative
 *  point per draggable element" convention. The caller projects each
 *  through its own data->px `project` (`mapRender.ts::dataToPx`). */
export function sectorHandlePositions(
  sector: RoiSector,
): Record<"qMin" | "qMax" | "phiMin" | "phiMax", { x: number; y: number }> {
  const span = sectorSpan(sector);
  const midPhi = sector.phiMin + span / 2;
  const midR = (sector.qMin + sector.qMax) / 2;
  return {
    qMin: polarPoint(sector.qMin, midPhi),
    qMax: polarPoint(sector.qMax, midPhi),
    phiMin: polarPoint(midR, sector.phiMin),
    phiMax: polarPoint(midR, sector.phiMax),
  };
}

export type SectorField = "qMin" | "qMax" | "phiMin" | "phiMax";

/** Hit-test result — mirrors `lib/roi.ts::RoiHit`'s discriminated-union
 *  shape without extending that type directly: a sector hit is never
 *  meaningfully a box/ruler hit or vice versa, and keeping this module
 *  independent of roi.ts's RoiHit union is what lets it live on its own
 *  (see this file's header on the pin). */
export type SectorHit = { kind: "handle"; field: SectorField } | { kind: "interior" } | null;

/** Polar hit-test about the reciprocal-lattice origin — the sector
 *  equivalent of `lib/roi.ts::classifyRoiHit`. `qx`/`qz` are the pointer's
 *  DATA-space position (already run through `pxToData`); `pxPerUnit` is the
 *  uniform data->px scale (see this file's header — only valid because the
 *  wedge is Q-space-only, where that scale genuinely IS uniform). Nearest-
 *  wins among the sector's 4 boundary elements (qMin/qMax arcs, phiMin/
 *  phiMax edges) within `tol` px; falls through to "interior" (radius in
 *  range AND angularly inside the span) when nothing boundary-ish is close
 *  enough; null otherwise. */
export function classifySectorHit(sector: RoiSector, qx: number, qz: number, pxPerUnit: number, tol = 7): SectorHit {
  const p = { x: qx, y: qz };
  const span = sectorSpan(sector);
  const scale = pxPerUnit > 0 ? pxPerUnit : 1;
  const phi = Math.atan2(qz, qx) * RAD2DEG;

  const qMinArc = nearestArcPoint(sector.qMin, sector.phiMin, span, phi);
  const qMaxArc = nearestArcPoint(sector.qMax, sector.phiMin, span, phi);
  const phiMinInner = polarPoint(sector.qMin, sector.phiMin);
  const phiMinOuter = polarPoint(sector.qMax, sector.phiMin);
  const phiMaxInner = polarPoint(sector.qMin, sector.phiMax);
  const phiMaxOuter = polarPoint(sector.qMax, sector.phiMax);

  const candidates: { field: SectorField; d: number }[] = [
    { field: "qMin", d: Math.hypot(p.x - qMinArc.x, p.y - qMinArc.y) * scale },
    { field: "qMax", d: Math.hypot(p.x - qMaxArc.x, p.y - qMaxArc.y) * scale },
    {
      field: "phiMin",
      d: pointToSegmentDistance(p, phiMinInner.x, phiMinInner.y, phiMinOuter.x, phiMinOuter.y) * scale,
    },
    {
      field: "phiMax",
      d: pointToSegmentDistance(p, phiMaxInner.x, phiMaxInner.y, phiMaxOuter.x, phiMaxOuter.y) * scale,
    },
  ];
  const nearest = candidates.reduce((best, c) => (c.d < best.d ? c : best));
  if (nearest.d <= tol) return { kind: "handle", field: nearest.field };

  const qrad = Math.hypot(qx, qz);
  const rebased = pymod(phi - sector.phiMin, 360);
  if (qrad >= sector.qMin && qrad <= sector.qMax && rebased <= span) return { kind: "interior" };
  return null;
}

/** Shortest signed a-b, in (-180, 180] — the rotate delta a drag frame
 *  applies, always the SHORT way around the circle (never a >180deg jump
 *  even right at the seam). */
function signedAngleDelta(a: number, b: number): number {
  return (((a - b + 180) % 360) + 360) % 360 - 180;
}

export interface SectorDragOptions {
  /** Pointer's azimuth (deg) at gesture START — required for an "interior"
   *  (rotate) drag so each move computes a DELTA from the start, not an
   *  absolute value (there's no absolute "the interior is at angle X" the
   *  way a handle has). Ignored for a "handle" drag. */
  startPhi?: number;
  /** Minimum radial gap enforced between qMin/qMax so a drag can never cross
   *  them into an inverted (qMin > qMax) sector — mirrors
   *  `lib/roi.ts::clampRectSize`'s "never collapse below a minimum" rule,
   *  simplified to a one-sided clamp since only ONE of the two radii ever
   *  moves per handle drag (unlike a rect corner, which moves two edges at
   *  once). */
  minRadialGap?: number;
}

/** Apply a DATA-space pointer position to a sector per its hit kind — the
 *  sector equivalent of `lib/roi.ts::applyRoiDrag`/`applyRulerDrag`. A
 *  "handle" drag SETS that one field directly from the pointer's own
 *  (|Q|, phi) (radial handles clamp against the OTHER radius so they can't
 *  invert; angular handles are UNCLAMPED — an exact zero-width phiMin===
 *  phiMax is a legal, intentional full circle per `sectorSpan`'s own
 *  convention, same as typing it into the numeric panel allows). An
 *  "interior" drag ROTATES: both phiMin/phiMax shift by the signed delta
 *  between the pointer's CURRENT azimuth and its azimuth at gesture start
 *  (`opts.startPhi`) — this is what "preserving span" means, and it is
 *  span-preserving by construction (both bounds move by the identical
 *  amount) regardless of whether the sector straddles the +-180 seam:
 *  phiMin/phiMax are never renormalized into any fixed range (Resolved
 *  decisions / `lib/roi.ts::sectorFromCenter`'s own doc — the backend's
 *  `wrap_mask` rebase is the only place that convention lives), so a
 *  seam-crossing sector (phiMin > phiMax numerically) stays exactly as
 *  seam-crossing after a rotate. */
export function applySectorDrag(
  base: RoiSector,
  hit: SectorHit,
  qx: number,
  qz: number,
  opts: SectorDragOptions = {},
): RoiSector {
  if (!hit) return base;
  const qrad = Math.hypot(qx, qz);
  const phi = Math.atan2(qz, qx) * RAD2DEG;
  const minGap = opts.minRadialGap ?? 0;

  if (hit.kind === "handle") {
    switch (hit.field) {
      case "qMin":
        return { ...base, qMin: Math.min(qrad, base.qMax - minGap) };
      case "qMax":
        return { ...base, qMax: Math.max(qrad, base.qMin + minGap) };
      case "phiMin":
        return { ...base, phiMin: phi };
      case "phiMax":
        return { ...base, phiMax: phi };
    }
  }

  const startPhi = opts.startPhi ?? phi;
  const dPhi = signedAngleDelta(phi, startPhi);
  return { ...base, phiMin: base.phiMin + dPhi, phiMax: base.phiMax + dPhi };
}

/** CSS cursor for a hit — "crosshair" for a field handle (no angle-aware
 *  resize cursor exists, same fallback `lib/roi.ts::roiCursor` uses for the
 *  ruler's end/width handles), "grab" for the interior (rotate — deliberately
 *  NOT "move", which `roiCursor` already uses for a rect's translate, so the
 *  two gestures read differently at a glance). */
export function sectorCursor(hit: SectorHit): string {
  if (!hit) return "default";
  return hit.kind === "interior" ? "grab" : "crosshair";
}
