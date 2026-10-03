// Resolve Origin figure snapshots (`figures.extract_figures`, plan item 18)
// against the datasets created by the same import, and describe how to
// display one in the Library. Pure/store-agnostic so the matching heuristic
// is unit-testable without mounting the store — `store/useApp.ts` owns the
// actual apply-to-plot-state action.
//
// EAGER HALF (bundle headroom slice 1, `plans/BUNDLE_HEADROOM.md`). Only what
// first paint needs lives here: the Library row label/family grouping and
// import-time entry construction. Slice 18 moved the curve style and
// legend-text helpers (`originCurveSeriesStyle`, `curveDisplayName`,
// `resolveLegendTemplate`) to `./originCurveText`, because only the lazy
// apply modules call them. Everything an APPLY needs —
// legend/annotation/region resolution (`./originFigureSelection`) and the
// spatial multi-panel solver (`./originSpatialPanels`) — moved to modules the
// store loads on demand via `store/originApplyLibs.ts`, taking their
// `originPanels`/`panelLayout`/`errorbars` transitive weight off first paint.
// Keep it that way: a static import of either module from an eagerly-reachable
// file silently folds them back into the entry chunk.

import type { Dataset, OriginFigure } from "./types";

/** One figure attached to an import "family" (one file's worth of books).
 *  `datasetId` is the best-effort resolved target, or null if the figure's
 *  loose `source_hint` didn't match any book created by this import — the
 *  Library shows it disabled with the hint in its tooltip rather than
 *  guessing wrong (never silently attaches to the wrong book). */
export interface OriginFigureEntry {
  id: string;
  stem: string;
  figure: OriginFigure;
  datasetId: string | null;
  /** Dataset ids created by the SAME import as this figure. Cross-book overlay
   *  resolution is scoped to these so a figure never pulls a same-named book
   *  (Origin's default `Book1`/`Book2`/… repeat across separate projects) from
   *  a different import. */
  siblingIds: string[];
}

/** Best-effort match of a figure's loose `source_hint` against the datasets
 *  created by the same import. Origin's graph windows only carry a partial
 *  worksheet reference (`docs/origin_re/opj_figures.md`), so this is a
 *  heuristic, not an exact curve->column resolution: an unambiguous single
 *  candidate always resolves; otherwise the hint is matched against the
 *  book's short/long Origin names, falling back to a substring check against
 *  the dataset's display name. */
export function resolveFigureDataset(figure: OriginFigure, candidates: Dataset[]): string | null {
  if (candidates.length === 1) return candidates[0].id; // one target - unambiguous
  if (candidates.length === 0) return null;
  // Decoded curve bindings name their book exactly — an exact match beats
  // every hint heuristic. (Curves may span books; the first match wins since
  // one figure entry activates one dataset.)
  for (const curve of figure.curves ?? []) {
    const hit = candidates.find(
      (c) => String((c.data.metadata ?? {}).origin_book ?? "") === curve.book,
    );
    if (hit) return hit.id;
  }
  const hint = (figure.source_hint ?? "").trim().toLowerCase();
  if (!hint) return null;
  for (const c of candidates) {
    const meta = (c.data.metadata ?? {}) as Record<string, unknown>;
    const short = String(meta.origin_book ?? "").trim().toLowerCase();
    const long = String(meta.origin_book_long ?? "").trim().toLowerCase();
    if (short && (hint === short || hint.includes(short) || short.includes(hint))) return c.id;
    if (long && (hint === long || hint.includes(long) || long.includes(hint))) return c.id;
    if (c.name.toLowerCase().includes(hint)) return c.id;
  }
  return null;
}
/** Build the Library entries for one import's figures, tagged with the
 *  import's file stem and matched against the dataset ids that same import
 *  just created (`useApp.importFiles`). */
export function buildOriginFigureEntries(
  stem: string,
  figures: OriginFigure[],
  candidates: Dataset[],
): OriginFigureEntry[] {
  const siblingIds = candidates.map((d) => d.id);
  // Key the id on the first sibling dataset id (import-unique -- dataset ids are
  // allocated monotonically) so two imports of a same-named file don't collide
  // on `fig-<stem>-<i>` and silently apply / React-reconcile the wrong entry.
  const importKey = siblingIds[0] ?? stem;
  return figures.map((figure, i) => ({
    id: `fig-${importKey}-${i}`,
    stem,
    figure,
    datasetId: resolveFigureDataset(figure, candidates),
    siblingIds,
  }));
}

/** Every layer-entry sharing `entry`'s graph window: same import (stem),
 *  same graph-window name — scoping to the import stops two imports of a
 *  same-named file from inflating the family (Origin's default window names
 *  like "Graph1" repeat across separate projects). Sorted by layer number
 *  ascending (undecoded/absent `layer` sorts as layer 1). A nameless figure
 *  or one with no same-window siblings returns just itself (family of 1) —
 *  callers treat `length < 2` as "no grouping applies". Shared by
 *  `doubleYPartner` (the 2-layer Y/Y2 idiom) and the spatial multi-panel
 *  apply (`resolveFigurePanels` below), which handles 2-or-more. */
export function figureLayerFamily(
  entry: OriginFigureEntry,
  all: OriginFigureEntry[],
): OriginFigureEntry[] {
  const name = entry.figure.name;
  if (!name) return [entry];
  const key = entry.siblingIds[0];
  return all
    .filter((e) => e.stem === entry.stem && e.figure.name === name && e.siblingIds[0] === key)
    .sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
}

/** Stable provenance id for one Origin graph window, independent of which
 * layer launched the action. Overlay reuse and discard confirmation must use
 * this id so Library and migration-review entry points cannot materialize
 * duplicate overlays for different layers of the same window. */
export function originFigureFamilyId(entry: OriginFigureEntry, all: OriginFigureEntry[]): string {
  return figureLayerFamily(entry, all)[0]?.id ?? entry.id;
}
/** Library row label: prefer a surviving annotation (reads like a plot title
 *  or peak label) over the raw Origin graph-window name (e.g. "Graph3"). */
export function figureLabel(entry: OriginFigureEntry): string {
  const f = entry.figure;
  const base = f.annotations[0] || f.name || "Figure";
  // Multi-layer .opj windows emit one figure per layer under the same window
  // name — suffix layers ≥2 so "Graph4" and "Graph4 · layer 2" read apart.
  return (f.layer ?? 1) >= 2 ? `${base} · layer ${f.layer}` : base;
}
