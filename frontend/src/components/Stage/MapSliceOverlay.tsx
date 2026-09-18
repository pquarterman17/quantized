// The committed H/V/segment slices and the map annotations, drawn over the
// heatmap canvas (audit P2.8 — "Preserve existing H/V/segment slices and link
// positions").
//
// An SVG sibling of the canvas, exactly like `MapRoiOverlay.tsx`: it projects
// DATA coordinates through the SAME `mapRender.dataToPx` the canvas paints
// with, so a slice drawn here lands on the pixel the cut was actually taken
// at, at any host size and any grid resolution. Nothing here is stateful — the
// definitions live in `store/mapView.ts` (one entry per dataset) and arrive as
// props, which is what makes them survive a regrid, a colour-limit change and
// a re-activation of the same dataset (none of which touch that entry).
//
// EVERY DEFINITION GETS A HANDLE (review round 2). A slice that cannot be
// drawn right now — recorded in the other axis space, or linked to a position
// outside the current payload's extent — is still KEPT, which is right (the
// map may be regridded or toggled back over it, and P2.8's box is about
// preserving positions, not about only keeping the ones in view). The first
// cut built the chips from the DRAWN list alone, so such a definition had no
// UI at all and could never be removed: invisible AND permanent. Undrawable
// definitions are therefore listed in a muted "parked" strip in the corner,
// each saying why it is not on the map, each removable by the same click as a
// drawn one.

import type { CSSProperties } from "react";

import type { CutSpace } from "../../lib/mapcuts";
import type { MapAnnotation, MapSliceDef } from "../../lib/mapView";
import type { MapPayload } from "../../lib/mapdataFetch";
import { dataToPx, fmt, plotRect } from "./mapRender";

export interface MapSliceOverlayProps {
  payload: MapPayload;
  w: number;
  h: number;
  slices: readonly MapSliceDef[];
  annotations: readonly MapAnnotation[];
  /** The axis space the map is showing right now — `cutSpaceForKeys`' result.
   *  Only definitions recorded in the SAME space are drawn: an RSM's
   *  angular⇄Q toggle swaps the axes without changing the dataset, so a slice
   *  taken at 2θ = 32 must not be redrawn at Qx = 32. */
  space: CutSpace | null;
  onRemoveSlice: (id: string) => void;
  onRemoveAnnotation: (id: string) => void;
}

type Pts = { a: [number, number]; b: [number, number] };

const axisSpan = (axis: readonly number[]): [number, number] | null => {
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  if (lo == null || hi == null) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
};

/** Push `v` into `[lo, hi]`. Used for the UNHELD coordinate of an h/v slice. */
const clamp = (v: number, span: [number, number]): number =>
  v < span[0] ? span[0] : v > span[1] ? span[1] : v;

/** The two endpoints of a slice in canvas px, or null when it cannot be drawn
 *  inside the current plot rect. An `h` slice spans the full x extent at its
 *  linked y; a `v` slice the full y extent at its linked x; a `seg` its own
 *  two picked points.
 *
 *  Only the HELD coordinate decides whether an h/v slice is drawable. The
 *  first cut projected the whole clicked point, so an `h` slice vanished when
 *  its x — the coordinate it does not use, kept only so the chip can say where
 *  the cut was taken — fell outside a narrower regrid, contradicting this very
 *  doc comment. The unheld component is clamped into its axis range instead;
 *  `seg`, whose both ends are real geometry, keeps the strict test. */
function endpoints(def: MapSliceDef, p: MapPayload, w: number, h: number): Pts | null {
  const rect = plotRect(p, w, h);
  if (def.kind === "seg") {
    if (!def.b) return null;
    const a = dataToPx(p, w, h, def.a.x, def.a.y);
    const b = dataToPx(p, w, h, def.b.x, def.b.y);
    return a && b ? { a, b } : null;
  }
  const xs = axisSpan(p.xAxis);
  const ys = axisSpan(p.yAxis);
  if (!xs || !ys) return null;
  const at =
    def.kind === "h"
      ? dataToPx(p, w, h, clamp(def.a.x, xs), def.a.y)
      : dataToPx(p, w, h, def.a.x, clamp(def.a.y, ys));
  if (!at) return null;
  return def.kind === "h"
    ? { a: [rect.x, at[1]], b: [rect.x + rect.w, at[1]] }
    : { a: [at[0], rect.y], b: [at[0], rect.y + rect.h] };
}

/** What the slice's chip says: the axis value it is LINKED to (an h slice is
 *  "at this y", a v slice "at this x"), or both endpoints for a segment. */
function sliceLabel(def: MapSliceDef): string {
  if (def.kind === "h") return `H ${fmt(def.a.y)}`;
  if (def.kind === "v") return `V ${fmt(def.a.x)}`;
  return def.b ? `S ${fmt(def.a.x)},${fmt(def.a.y)} → ${fmt(def.b.x)},${fmt(def.b.y)}` : "S";
}

const spaceName = (s: CutSpace | null): string =>
  s === "q" ? "reciprocal (Q) space" : s === "angular" ? "angular space" : "a plain map";

/** Why this definition is not on the map — the chip's tooltip. */
function parkedReason(recorded: CutSpace | null, shown: CutSpace | null): string {
  return recorded === shown
    ? "Outside the map's current extent — remove it, or regrid over it"
    : `Recorded in ${spaceName(recorded)}, the map is showing ${spaceName(shown)}`;
}

const CHIP: CSSProperties = {
  pointerEvents: "auto",
  font: "10px var(--font-mono)",
  padding: "1px 5px",
  borderRadius: 3,
  color: "var(--text)",
};

/** Geometry budget for the parked strip (P2.8 review round 3, finding 11).
 *  A label is capped at 200 CHARACTERS by the sanitizer, which is not a
 *  budget in PIXELS: one such chip rendered as a single 202-character row,
 *  and several parked definitions wrapped the strip upward out of the bottom
 *  margin (`MARGIN.bottom = 42`), across the plot and under the colourbar.
 *  Each chip now truncates with an ellipsis (the full text stays in its
 *  `title`, which is where the reason already lives), and the strip itself
 *  scrolls past four rows instead of growing. */
const PARKED_CHIP: CSSProperties = {
  ...CHIP,
  border: "1px dashed var(--border)",
  color: "var(--text-dim)",
  maxWidth: 180,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export default function MapSliceOverlay({
  payload,
  w,
  h,
  slices,
  annotations,
  space,
  onRemoveSlice,
  onRemoveAnnotation,
}: MapSliceOverlayProps) {
  const drawn: { def: MapSliceDef; pts: Pts }[] = [];
  const parkedSlices: MapSliceDef[] = [];
  for (const def of slices) {
    const pts = def.space === space ? endpoints(def, payload, w, h) : null;
    if (pts) drawn.push({ def, pts });
    else parkedSlices.push(def);
  }
  const labels: { ann: MapAnnotation; px: [number, number] }[] = [];
  const parkedAnnotations: MapAnnotation[] = [];
  for (const ann of annotations) {
    const px = ann.space === space ? dataToPx(payload, w, h, ann.x, ann.y) : null;
    if (px) labels.push({ ann, px });
    else parkedAnnotations.push(ann);
  }

  if (slices.length === 0 && annotations.length === 0) return null;

  return (
    <div
      className="qzk-map-slices"
      data-testid="map-slice-overlay"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {drawn.map(({ def, pts }) => (
          <line
            key={def.id}
            data-testid="map-slice-line"
            data-slice-id={def.id}
            data-slice-kind={def.kind}
            x1={pts.a[0]}
            y1={pts.a[1]}
            x2={pts.b[0]}
            y2={pts.b[1]}
            stroke="var(--accent)"
            strokeWidth={1.25}
            strokeDasharray="6 3"
          />
        ))}
      </svg>
      {drawn.map(({ def, pts }) => (
        <button
          key={def.id}
          type="button"
          className="qzk-glass"
          data-testid="map-slice-chip"
          data-slice-id={def.id}
          title={`Remove this ${def.kind === "seg" ? "segment" : def.kind.toUpperCase()} slice`}
          onClick={() => onRemoveSlice(def.id)}
          style={{
            ...CHIP,
            position: "absolute",
            left: Math.round((pts.a[0] + pts.b[0]) / 2),
            top: Math.round((pts.a[1] + pts.b[1]) / 2),
            transform: "translate(-50%, -50%)",
            border: "1px solid var(--accent)",
          }}
        >
          {sliceLabel(def)} ✕
        </button>
      ))}
      {labels.map(({ ann, px }) => (
        <button
          key={ann.id}
          type="button"
          className="qzk-glass"
          data-testid="map-annotation"
          data-annotation-id={ann.id}
          title="Remove this label"
          onClick={() => onRemoveAnnotation(ann.id)}
          style={{
            ...CHIP,
            position: "absolute",
            left: Math.round(px[0]),
            top: Math.round(px[1]),
            transform: "translate(-50%, -120%)",
            font: "11px var(--font-ui)",
            border: "1px solid var(--border)",
          }}
        >
          {ann.text}
        </button>
      ))}
      {(parkedSlices.length > 0 || parkedAnnotations.length > 0) && (
        <div
          data-testid="map-parked-strip"
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 4,
            maxWidth: "60%",
            maxHeight: 72,
            overflowY: "auto",
          }}
        >
          {parkedSlices.map((def) => (
            <button
              key={def.id}
              type="button"
              className="qzk-glass"
              data-testid="map-parked-chip"
              data-parked-kind="slice"
              data-slice-id={def.id}
              title={`${parkedReason(def.space, space)} — click to remove`}
              onClick={() => onRemoveSlice(def.id)}
              style={PARKED_CHIP}
            >
              {sliceLabel(def)} ✕
            </button>
          ))}
          {parkedAnnotations.map((ann) => (
            <button
              key={ann.id}
              type="button"
              className="qzk-glass"
              data-testid="map-parked-chip"
              data-parked-kind="annotation"
              data-annotation-id={ann.id}
              title={`${parkedReason(ann.space, space)} — click to remove`}
              onClick={() => onRemoveAnnotation(ann.id)}
              style={PARKED_CHIP}
            >
              {ann.text} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
