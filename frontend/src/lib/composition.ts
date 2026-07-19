// Plot composition (ORIGIN_FILE_DECODE_PLAN #54, pass A) — the ONE explicit
// description of how the stage is arranged into panels.
//
// Replaces three parallel nullable store fields (`spatialPanels` /
// `facetPanels` / `breakPanels`) whose mutual exclusion was documented but
// hand-enforced: every `set()` that assigned one had to remember to null the
// other two (seven separate sites in `store/useApp.ts`), and the render side
// re-derived a spatial > break > facet precedence chain independently in
// `components/Stage/useMultiPanelStage.ts`. A discriminated union makes the
// exclusion STRUCTURAL — two kinds cannot coexist, so there is no precedence
// left to re-derive and no site left to forget.
//
// Two invariants this module owns:
//   1. "No composition" has exactly ONE representation: `null`. The
//      constructors below return `null` for an empty panel list rather than a
//      kind-tagged object wrapping `[]`, so callers never have to test both
//      `c == null` and `c.panels.length === 0`.
//   2. The accessors return the panel array BY REFERENCE (or `null`), never a
//      fresh array or object. That keeps them safe to call inside a Zustand
//      selector under the stable-snapshot rule — `useApp((s) =>
//      spatialPanelsOf(s.composition))` re-renders on real changes only.
//
// Pure: types + total functions, no store import. This is also the substrate
// #54's reserved `PlotSpec.page` block serializes (pass C) — the page/layer
// geometry attaches to a composition, not to three ad-hoc arrays.

import type { BreakPanel, FacetPanel } from "./facet";
import type { SpatialPanel } from "./multipanel";

/** Which arrangement the stage is in. See each composition type for what a
 *  "panel" means in that kind — they are deliberately different shapes. */
export type CompositionKind = "spatial" | "facet" | "break";

/** Origin-imported multi-layer figure (decode-plan #36): each panel is a
 *  REFERENCE (datasetId + xKey/yKeys) that the render side fetches and gives
 *  its own fixed axis state, because a panel may point at a wholly different
 *  dataset. Carries the decoded page/frame geometry (`pageRect`/`frameRect`)
 *  that `lib/panelLayout.ts` turns into pixel rects. */
export interface SpatialComposition {
  kind: "spatial";
  panels: SpatialPanel[];
}

/** Facet-by-column small multiples: each panel is a row-filtered SLICE of one
 *  dataset, already materialized as a `PlotPayload` by `facet.facetPayloads`.
 *  No per-panel dataset reference and no per-panel axis state — faceting's
 *  whole point is a shared x-domain the render side computes once. */
export interface FacetComposition {
  kind: "facet";
  panels: FacetPanel[];
}

/** Paneled x-breaks: one panel per contiguous x-segment, each keeping its own
 *  local x-range but sharing ONE y-domain across the row
 *  (`facet.sharedYDomain`). */
export interface BreakComposition {
  kind: "break";
  panels: BreakPanel[];
}

export type Composition = SpatialComposition | FacetComposition | BreakComposition;

/** Build a spatial composition, or `null` when there is nothing to arrange.
 *  (Invariant 1: empty never becomes a kind-tagged empty object.) */
export function spatialComposition(panels: SpatialPanel[]): Composition | null {
  return panels.length > 0 ? { kind: "spatial", panels } : null;
}

export function facetComposition(panels: FacetPanel[]): Composition | null {
  return panels.length > 0 ? { kind: "facet", panels } : null;
}

export function breakComposition(panels: BreakPanel[]): Composition | null {
  return panels.length > 0 ? { kind: "break", panels } : null;
}

/** The spatial panels, or `null` when the composition is a different kind (or
 *  absent). Reference-stable — safe inside a Zustand selector. */
export function spatialPanelsOf(c: Composition | null): SpatialPanel[] | null {
  return c !== null && c.kind === "spatial" ? c.panels : null;
}

export function facetPanelsOf(c: Composition | null): FacetPanel[] | null {
  return c !== null && c.kind === "facet" ? c.panels : null;
}

export function breakPanelsOf(c: Composition | null): BreakPanel[] | null {
  return c !== null && c.kind === "break" ? c.panels : null;
}

/** How many panels the composition arranges (0 when absent). Cheap enough to
 *  call in a render gate. */
export function compositionPanelCount(c: Composition | null): number {
  return c === null ? 0 : c.panels.length;
}
