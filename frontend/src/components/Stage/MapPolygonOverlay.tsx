// The Polygon tool's drawing on the 2-D map: the closed polygon (outline, fill and,
// while the tool is armed, a handle per vertex), the outline being drawn with its
// rubber-band edge, a one-line hint while drawing, and a small bar naming the
// vertex count and area with a Remove button. Everything is projected with the
// same `dataToPx` the canvas and the box use. Pointer-transparent except the bar,
// which goes transparent too while a vertex is dragged (see MapRoiOverlay's note).

import { removeRowSafely } from "../../lib/focusGuard";
import type { MapPayload } from "../../lib/mapdataFetch";
import { polygonToPx, signedArea } from "../../lib/roiPolygon";
import { dataToPx, fmt, plotRect } from "./mapRender";
import { barPosition, boundsOfPoints } from "./roiBarLayout";
import type { UseMapPolygonState } from "./useMapPolygon";
import { isDeleteKey } from "../../lib/deleteKey";

interface Props {
  payload: MapPayload;
  w: number;
  h: number;
  state: UseMapPolygonState;
  /** Surviving focus target for removeRowSafely (the map canvas). */
  focusAnchor?: () => HTMLElement | null;
}

const HINT = "Click to add vertices · double-click or Enter closes · Backspace removes the last · Esc abandons";

export default function MapPolygonOverlay({ payload, w, h, state, focusAnchor }: Props) {
  const { polygon, draft, cursorPx, mode } = state;
  const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
  const closedPx = polygon ? polygonToPx(polygon.points, project) : null;
  const draftPx = draft.length > 0 ? polygonToPx(draft, project) : null;
  if (!closedPx && !draftPx) return null;
  const armed = mode === "polygon";
  const pts = (a: readonly { x: number; y: number }[]) => a.map((p) => `${p.x},${p.y}`).join(" ");
  const last = draftPx ? draftPx[draftPx.length - 1] : null;

  return (
    <>
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
        {closedPx && polygon && (
          <g data-polygon-roi="closed">
            <polygon points={pts(closedPx)} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.5} />
            {armed && closedPx.map((p, i) => (
              <rect key={i} data-roi-handle={`polygon-${i}`} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="var(--accent)" stroke="var(--surface-0)" />
            ))}
          </g>
        )}
        {draftPx && (
          <g data-polygon-roi="draft">
            <polyline points={pts(draftPx)} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 4" />
            {last && cursorPx && (
              <line x1={last.x} y1={last.y} x2={cursorPx[0]} y2={cursorPx[1]} stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 3" />
            )}
            {draftPx.map((p, i) => (
              <rect key={i} data-roi-handle={`draft-${i}`} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="var(--accent)" stroke="var(--surface-0)" />
            ))}
          </g>
        )}
      </svg>
      {draftPx && (
        <div className="qzk-glass qzk-roi-readout" style={{ position: "absolute", left: 8, bottom: 8, padding: "2px 8px", pointerEvents: "none" }}>
          {HINT}
        </div>
      )}
      {armed && polygon && closedPx && !draftPx && (
        <div
          className="qzk-glass qzk-roi-bar"
          style={{ ...barPosition(boundsOfPoints(closedPx), plotRect(payload, w, h)), height: "auto", pointerEvents: state.dragging ? "none" : undefined }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (isDeleteKey(e)) e.preventDefault();
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="qzk-roi-readout">
              Polygon: {polygon.points.length} vertices, area {fmt(Math.abs(signedArea(polygon.points)))}
            </span>
            <button
              aria-label="Remove this polygon"
              className="qzk-tool-btn"
              title="Remove this polygon"
              onClick={() => removeRowSafely(focusAnchor?.() ?? null, state.remove)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
