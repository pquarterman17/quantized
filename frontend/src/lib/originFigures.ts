// Resolve Origin figure snapshots (`figures.extract_figures`, plan item 18)
// against the datasets created by the same import, and describe how to
// display one in the Library. Pure/store-agnostic so the matching heuristic
// is unit-testable without mounting the store — `store/useApp.ts` owns the
// actual apply-to-plot-state action.
//
// EAGER HALF (bundle headroom slice 1, `plans/BUNDLE_HEADROOM.md`). Only what
// first paint needs lives here: the Library row label/family grouping.
// Import-time entry construction (`buildOriginFigureEntries`,
// `resolveFigureDataset`) moved to `./originFigureEntries`, which only the
// lazy import path calls (2026-11-13, readers integration). Slice 18 moved the curve style and
// legend-text helpers (`originCurveSeriesStyle`, `curveDisplayName`,
// `resolveLegendTemplate`) to `./originCurveText`, because only the lazy
// apply modules call them. Everything an APPLY needs —
// legend/annotation/region resolution (`./originFigureSelection`) and the
// spatial multi-panel solver (`./originSpatialPanels`) — moved to modules the
// store loads on demand via `store/originApplyLibs.ts`, taking their
// `originPanels`/`panelLayout`/`errorbars` transitive weight off first paint.
// Keep it that way: a static import of either module from an eagerly-reachable
// file silently folds them back into the entry chunk.

import type { OriginFigure } from "./types";

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
  /** Explicit recovery choices keyed by the saved Origin workbook name.
   * Values are dataset ids from this import's `siblingIds`. The decoded
   * figure stays untouched; consumers use this provenance map only when an
   * exact saved-book match was unavailable and the user confirmed a preview. */
  sourceOverrides?: Record<string, string>;
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

/** Origin substitution codes (`%(?X)`, `%(1)`, `$(...)`): text Origin fills in
 *  when it draws, never meant to be read raw. */
const ORIGIN_TEMPLATE = /[%$]\(/;

/** An annotation as a title: Origin's auto axis-title codes `%(?X)` / `%(?Y)`
 *  resolve to the decoded axis titles when those are known; anything still
 *  holding a substitution code is no title at all (`""`). */
export function resolvedTitleText(text: string, f: OriginFigureEntry["figure"]): string {
  const out = text
    .replace(/%\(\?X\)/g, () => f.x_title || "%(?X)")
    .replace(/%\(\?Y\)/g, () => f.y_title || "%(?Y)")
    .trim();
  return ORIGIN_TEMPLATE.test(out) ? "" : out;
}

/** An annotation fit to show beside a window name: printable text with a
 *  letter or digit, no rich-text escape (`\\b(`) and no `?` / U+FFFD
 *  stand-in for bytes that did not decode (`"?iiiiii"`). Long text is cut. */
function cleanAnnotation(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return "";
  const junk = [...t].some((c) => c < " " || c === "\u007f" || c === "\ufffd" || c === "\\");
  if (junk || t.startsWith("?") || t.includes("??")) return "";
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

/** Library row label: the Origin graph-window name first (what the user
 *  named it, and what tells "Graph1" from "Graph2"), then the first decoded
 *  annotation when it reads as text — e.g. "Graph3 — Si (004)". An
 *  annotation that is an unresolved substitution code, junk bytes or the
 *  name again is left out; a window with no name falls back to it. */
export function figureLabel(entry: OriginFigureEntry): string {
  const f = entry.figure;
  const note = f.annotations[0] ? cleanAnnotation(resolvedTitleText(f.annotations[0], f)) : "";
  const name = (f.name ?? "").trim();
  const base = name && note && note !== name ? `${name} — ${note}` : name || note || "Figure";
  // Multi-layer .opj windows emit one figure per layer under the same window
  // name — suffix layers ≥2 so "Graph4" and "Graph4 · layer 2" read apart.
  return (f.layer ?? 1) >= 2 ? `${base} · layer ${f.layer}` : base;
}
