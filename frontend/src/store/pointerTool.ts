// The pointer-tool slice (MAIN #18): free legend position + the annotation
// selection/update action, composed into the ONE useApp store instance
// exactly like ./reductions (read its header first — this is the smallest of
// the extracted slices, same "kept tiny so it doesn't grow useApp.ts past its
// store-size ratchet pin" reasoning). `legendXY` is a genuine PlotView field
// (participates in the focused-window facade's snapshotView/hydrateView and
// `.dwk` sanitizeView — see lib/plotview.ts) even though it's declared here
// rather than inline in useApp.ts's own field list: Zustand slices merge into
// ONE flat state object at runtime, so it doesn't matter which slice's
// interface a field's TYPE lives on, only that the runtime value is a normal
// top-level store field — which this factory's returned object provides.
// `selectedAnnotationId` is deliberately NOT a PlotView field (transient,
// like qfitRoi) and is NOT reset on window/dataset focus switch (unlike the
// qfitRoi-shaped fields windows.ts's focusTransientReset clears — that
// helper is already at store/windows.ts's own size-ratchet pin, so adding a
// line there was avoided): annotation ids are drawn from one module-global
// sequence (`_annSeq` in useApp.ts), never reused across windows/datasets,
// so a stale id left over from a previous focus can never accidentally
// match a DIFFERENT annotation — worst case it simply matches nothing (no
// selection outline drawn) until the user picks again.

import { clampAnnotationSize } from "../lib/uplotOverlays";
import type { Annotation, AxisKey, AxisLabelOffsets, AxisLabelStyle, AxisLabelStyles } from "../lib/types";
import type { AppState } from "./useApp";

export interface PointerToolSlice {
  /** Free legend position (MAIN #18), FRACTIONS of the plot area — see
   *  `PlotView.legendXY`'s doc. */
  legendXY: [number, number] | null;
  /** Setting a free `legendXY` (a pointer-mode box drag, or the reset that
   *  passes `null`) ALSO clears `legendFrameXY` — the frame anchor is a
   *  one-way degrade (decode #52): the moment the user grabs the box, it
   *  leaves Origin's frame-anchored placement and follows the container-
   *  fraction flow, and a reset clears both (falling back to the corner
   *  `legendPos` the same figure apply already pinned). */
  setLegendXY: (xy: [number, number] | null) => void;
  /** Frame-anchored legend position (decode #52): the legend box TOP-LEFT as
   *  FRACTIONS of the plot FRAME (uPlot's plotting area) — see
   *  `PlotView.legendFrameXY`'s doc for the origin/y-direction. Set by
   *  `applyOriginFigure` (via `originLegendState`) when Origin's decoded
   *  legend position lands inside the frame; null otherwise. Wins over
   *  `legendXY` and the corner `legendPos` while set. No dedicated setter —
   *  the apply spreads it directly and `setLegendXY` clears it. */
  legendFrameXY: [number, number] | null;
  /** Per-axis title drag offsets (CSS px) — a genuine PlotView field like
   *  `legendXY` (snapshot/hydrate/`.dwk` sanitize in lib/plotview.ts). */
  axisLabelOffsets: AxisLabelOffsets;
  /** Move an axis title (offset in CSS px) or reset it to default (null). */
  setAxisLabelOffset: (axis: AxisKey, offset: [number, number] | null) => void;
  /** Per-axis title text style (right-click ▸ Format). */
  axisLabelStyles: AxisLabelStyles;
  /** Merge a style patch onto one axis title; a patch that empties the style
   *  removes the axis entry (back to default). */
  setAxisLabelStyle: (axis: AxisKey, patch: Partial<AxisLabelStyle>) => void;
  /** The annotation selected in pointer mode (click-select / drag-to-move
   *  target); null = nothing selected. Transient, not window-scoped — see
   *  the module doc for why that's safe. */
  selectedAnnotationId: string | null;
  setSelectedAnnotationId: (id: string | null) => void;
  /** Commit an annotation edit (drag-move, corner-handle resize, text edit,
   *  MAIN #21's page/data anchor toggle) ONCE — the refLine/anchor
   *  "plugin-local live preview, store commits on release" pattern.
   *  `patch.size` (if present) is clamped the same way the plugin's live
   *  preview already clamps it. No-op for an unknown id. */
  updateAnnotation: (
    id: string,
    patch: Partial<Pick<Annotation, "x" | "y" | "text" | "size" | "anchor" | "frame" | "groupId">>,
  ) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createPointerToolSlice(set: SliceSet, get: SliceGet): PointerToolSlice {
  return {
    legendXY: null,
    legendFrameXY: null,
    // Clears the frame anchor too (decode #52) — see the interface doc.
    setLegendXY: (legendXY) => set({ legendXY, legendFrameXY: null }),
    axisLabelOffsets: {},
    setAxisLabelOffset: (axis, offset) => {
      get().recordHistory("move axis title");
      set((s) => {
        const next = { ...s.axisLabelOffsets };
        if (offset === null) delete next[axis];
        else next[axis] = offset;
        return { axisLabelOffsets: next };
      });
    },
    axisLabelStyles: {},
    setAxisLabelStyle: (axis, patch) => {
      get().recordHistory("format axis title");
      set((s) => {
        const merged: AxisLabelStyle = { ...s.axisLabelStyles[axis], ...patch };
        // Drop falsy/undefined keys so an emptied style resets to default.
        if (!merged.size) delete merged.size;
        if (!merged.italic) delete merged.italic;
        if (!merged.bold) delete merged.bold;
        const next = { ...s.axisLabelStyles };
        if (Object.keys(merged).length === 0) delete next[axis];
        else next[axis] = merged;
        return { axisLabelStyles: next };
      });
    },
    selectedAnnotationId: null,
    setSelectedAnnotationId: (selectedAnnotationId) => set({ selectedAnnotationId }),
    updateAnnotation: (id, patch) => {
      get().recordHistory("edit annotation");
      set((s) => ({
        annotations: s.annotations.map((a) =>
          a.id === id
            ? { ...a, ...patch, ...(patch.size !== undefined ? { size: clampAnnotationSize(patch.size) } : {}) }
            : a,
        ),
      }));
    },
  };
}
