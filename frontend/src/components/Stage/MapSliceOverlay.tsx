// The committed H/V/segment slices and the map annotations, drawn over the
// heatmap canvas (audit P2.8 — "Preserve existing H/V/segment slices and link
// positions").
//
// An SVG sibling of the canvas, exactly like `MapRoiOverlay.tsx`: it projects
// DATA coordinates through the SAME `mapRender.dataToPx` the canvas paints
// with, so a slice drawn here lands on the pixel the cut was actually taken
// at, at any host size and any grid resolution. Nothing here is stateful — the
// definitions live in `store/mapView.ts` and arrive as props, which is what
// makes them survive a regrid, a colour-limit change and a re-activation of
// the same dataset (none of which touch that field).
//
// A slice whose linked position falls OUTSIDE the current payload's extent is
// simply not drawn — `mapRender.dataToPx` returns null for a point off the
// axes, and `endpoints` below propagates that. The DEFINITION is kept either
// way: the map may be regridded back over it, and P2.8's box is about
// preserving positions, not about only keeping the ones currently in view.

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

/** The two endpoints of a slice in canvas px, or null when it cannot be drawn
 *  inside the current plot rect. An `h` slice spans the full x extent at its
 *  linked y; a `v` slice the full y extent at its linked x; a `seg` its own
 *  two picked points. */
function endpoints(
  def: MapSliceDef,
  p: MapPayload,
  w: number,
  h: number,
): { a: [number, number]; b: [number, number] } | null {
  const rect = plotRect(p, w, h);
  if (def.kind === "seg") {
    if (!def.b) return null;
    const a = dataToPx(p, w, h, def.a.x, def.a.y);
    const b = dataToPx(p, w, h, def.b.x, def.b.y);
    return a && b ? { a, b } : null;
  }
  const at = dataToPx(p, w, h, def.a.x, def.a.y);
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
  const drawn = slices
    .filter((def) => def.space === space)
    .map((def) => ({ def, pts: endpoints(def, payload, w, h) }))
    .filter((e): e is { def: MapSliceDef; pts: { a: [number, number]; b: [number, number] } } =>
      e.pts !== null,
    );
  const labels = annotations
    .filter((ann) => ann.space === space)
    .map((ann) => ({ ann, px: dataToPx(payload, w, h, ann.x, ann.y) }))
    .filter((e): e is { ann: MapAnnotation; px: [number, number] } => e.px !== null);

  if (drawn.length === 0 && labels.length === 0) return null;

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
            position: "absolute",
            left: Math.round((pts.a[0] + pts.b[0]) / 2),
            top: Math.round((pts.a[1] + pts.b[1]) / 2),
            transform: "translate(-50%, -50%)",
            pointerEvents: "auto",
            font: "10px var(--font-mono)",
            padding: "1px 5px",
            border: "1px solid var(--accent)",
            borderRadius: 3,
            color: "var(--text)",
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
            position: "absolute",
            left: Math.round(px[0]),
            top: Math.round(px[1]),
            transform: "translate(-50%, -120%)",
            pointerEvents: "auto",
            font: "11px var(--font-ui)",
            padding: "1px 5px",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text)",
          }}
        >
          {ann.text}
        </button>
      ))}
    </div>
  );
}
