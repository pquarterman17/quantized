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
import type { Annotation } from "../lib/types";
import type { AppState } from "./useApp";

export interface PointerToolSlice {
  /** Free legend position (MAIN #18), FRACTIONS of the plot area — see
   *  `PlotView.legendXY`'s doc. */
  legendXY: [number, number] | null;
  setLegendXY: (xy: [number, number] | null) => void;
  /** The annotation selected in pointer mode (click-select / drag-to-move
   *  target); null = nothing selected. Transient, not window-scoped — see
   *  the module doc for why that's safe. */
  selectedAnnotationId: string | null;
  setSelectedAnnotationId: (id: string | null) => void;
  /** Commit an annotation edit (drag-move, corner-handle resize, text edit)
   *  ONCE — the refLine/anchor "plugin-local live preview, store commits on
   *  release" pattern. `patch.size` (if present) is clamped the same way the
   *  plugin's live preview already clamps it. No-op for an unknown id. */
  updateAnnotation: (id: string, patch: Partial<Pick<Annotation, "x" | "y" | "text" | "size">>) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createPointerToolSlice(set: SliceSet): PointerToolSlice {
  return {
    legendXY: null,
    setLegendXY: (legendXY) => set({ legendXY }),
    selectedAnnotationId: null,
    setSelectedAnnotationId: (selectedAnnotationId) => set({ selectedAnnotationId }),
    updateAnnotation: (id, patch) =>
      set((s) => ({
        annotations: s.annotations.map((a) =>
          a.id === id
            ? { ...a, ...patch, ...(patch.size !== undefined ? { size: clampAnnotationSize(patch.size) } : {}) }
            : a,
        ),
      })),
  };
}
