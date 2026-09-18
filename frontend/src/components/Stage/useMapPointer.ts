// Every canvas pointer gesture the 2-D map understands, in one place:
// hit-testing a client point back to data coordinates, the hover readout, the
// armed-tool dispatch (box / ruler / wedge, via `mapToolArming.routedTool`),
// the H/V click and the segment drag that fire a cut, and the double-click
// that pins a map annotation.
//
// Extracted out of `MapStage.tsx` by audit P2.8 for the same reason
// `mapToolArming.ts` and `MapToolbar.tsx` were before it: that component was
// at 389 of its 400-line ceiling, and P2.8 needs the cut gestures to ALSO
// record a durable slice definition (store/mapView.ts) and to grow an
// annotation gesture. This is the cohesive block to move — it is pure event
// plumbing over values the component already derives, with no JSX.
//
// WHAT IT DOES NOT DO: it never decides WHETHER a cut may run. That gate
// (`cuts.mode`, and `cutSpace != null` before `runLine`/`runSegment` are even
// reachable) stays exactly where it was, in `useMapCuts`/`MapStage`; this hook
// only turns pixels into the data-space arguments those calls take. Behaviour
// is unchanged from the inline version except for the two P2.8 additions,
// which are the `onSlice`/`onAnnotate` callbacks — pass no-ops and this hook
// behaves exactly as `MapStage` did before.

import { useState } from "react";

import type { CutPoint, CutSpace } from "../../lib/mapcuts";
import type { MapPayload } from "../../lib/mapdataFetch";
import type { ArmedTool } from "./mapToolArming";
import { hitTest, type Readout } from "./mapRender";
import type { MapCutsState } from "./useMapCuts";

/** Canvas-pixel endpoints of an in-progress segment drag (the dashed SVG
 *  preview line MapStage renders). */
export interface DragPx {
  a: [number, number];
  b: [number, number];
}

export interface MapPointerOptions {
  payload: MapPayload | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** The one armed box/ruler/wedge tool, or null — `routedTool`'s result. */
  routed: ArmedTool | null;
  cuts: MapCutsState;
  /** The host box in CSS px, as the paint effect measured it. */
  hostSize: { w: number; h: number };
  /** Non-null only when the displayed axes are a cuttable RSM pair. */
  cutSpace: CutSpace | null;
  /** P2.8: a cut was just TAKEN at these data coordinates — record the durable
   *  slice definition. Called with the same points the cut request was built
   *  from, so the drawn slice and the landed 1-D dataset can never disagree
   *  about where the cut was taken.
   *
   *  Fired when the request is ISSUED, not when it succeeds, and deliberately:
   *  the slice records the position the USER marked on the map, while the 1-D
   *  dataset is the backend's answer about it. A backend that is down (or the
   *  offline fallback, which has no cut endpoint at all) reports its failure
   *  through `useCutLanding`'s status line; it must not also silently discard
   *  the marks the user has been placing. */
  onSlice: (kind: "h" | "v" | "seg", a: CutPoint, b: CutPoint | null) => void;
  /** P2.8: double-click on an idle map — pin an annotation here. */
  onAnnotate: (x: number, y: number) => void;
}

export interface MapPointerState {
  readout: Readout | null;
  dragPx: DragPx | null;
  onMove: (ev: React.MouseEvent<HTMLCanvasElement>) => void;
  onClick: (ev: React.MouseEvent<HTMLCanvasElement>) => void;
  onDoubleClick: (ev: React.MouseEvent<HTMLCanvasElement>) => void;
  onDown: (ev: React.MouseEvent<HTMLCanvasElement>) => void;
  onUp: (ev: React.MouseEvent<HTMLCanvasElement>) => void;
  /** Pointer left the canvas — drop the readout and any in-flight drag. The
   *  caller still calls each tool's own `onLeave` alongside this. */
  onLeave: () => void;
}

export function useMapPointer(opts: MapPointerOptions): MapPointerState {
  const { payload, canvasRef, hostRef, routed, cuts, hostSize, cutSpace } = opts;
  const [readout, setReadout] = useState<Readout | null>(null);
  const [dragPx, setDragPx] = useState<DragPx | null>(null);

  function hitAt(ev: React.MouseEvent<HTMLCanvasElement>): {
    r: Readout | null;
    px: [number, number];
  } {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!payload || !canvas || !host) return { r: null, px: [0, 0] };
    const rect = canvas.getBoundingClientRect();
    const px: [number, number] = [ev.clientX - rect.left, ev.clientY - rect.top];
    return { r: hitTest(payload, host.clientWidth, host.clientHeight, px[0], px[1]), px };
  }

  return {
    readout,
    dragPx,
    onLeave: () => {
      setReadout(null);
      setDragPx(null);
    },
    onMove: (ev) => {
      const { r, px } = hitAt(ev);
      setReadout(r);
      if (routed && payload) {
        routed.onMove(payload, hostSize.w, hostSize.h, px);
        return;
      }
      if (dragPx) setDragPx({ a: dragPx.a, b: px });
    },
    onClick: (ev) => {
      if (routed) return;
      if (cuts.mode !== "h" && cuts.mode !== "v") return;
      const { r } = hitAt(ev);
      if (!r) return;
      const at = { x: r.x, y: r.y };
      cuts.runLine(cuts.mode, at);
      // Gated on `cutSpace` for the same reason `useMapCuts.runLine` is: with
      // no cut space there is no cut, so there is no slice to record either.
      if (cutSpace != null) opts.onSlice(cuts.mode, at, null);
    },
    // P2.8: an idle map (no cut armed, no box/ruler/wedge armed) takes a text
    // label where it is double-clicked. Deliberately gated on "idle" — while a
    // tool owns the gestures, a double-click is two of that tool's own clicks
    // and must not also drop a label on the map.
    onDoubleClick: (ev) => {
      if (routed || cuts.mode !== "off") return;
      const { r } = hitAt(ev);
      if (r) opts.onAnnotate(r.x, r.y);
    },
    onDown: (ev) => {
      if (routed && payload) {
        const { px } = hitAt(ev);
        routed.onDown(payload, hostSize.w, hostSize.h, px);
        return;
      }
      if (cuts.mode !== "seg") return;
      const { r, px } = hitAt(ev);
      if (r) setDragPx({ a: px, b: px });
    },
    onUp: (ev) => {
      if (routed) {
        const { px } = hitAt(ev);
        routed.onUp(px);
        return;
      }
      if (cuts.mode !== "seg" || !dragPx) return;
      const canvas = canvasRef.current;
      const host = hostRef.current;
      setDragPx(null);
      if (!payload || !canvas || !host) return;
      const start = hitTest(payload, host.clientWidth, host.clientHeight, dragPx.a[0], dragPx.a[1]);
      const { r: end } = hitAt(ev);
      if (!start || !end) return;
      const a = { x: start.x, y: start.y };
      const b = { x: end.x, y: end.y };
      cuts.runSegment(a, b);
      if (cutSpace != null) opts.onSlice("seg", a, b);
    },
  };
}
