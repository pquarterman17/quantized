// Resolve Origin figure snapshots (`figures.extract_figures`, plan item 18)
// against the datasets created by the same import, and describe how to
// display one in the Library. Pure/store-agnostic so the matching heuristic
// is unit-testable without mounting the store — `store/useApp.ts` owns the
// actual apply-to-plot-state action.

import type { Dataset, OriginCurve, OriginFigure } from "./types";

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

/** Channel selection for a figure's decoded curves on its resolved dataset:
 *  maps each curve's Origin column letter through the dataset's
 *  `origin_column_names` metadata (value-channel letters, in channel order)
 *  onto `xKey`/`yKeys` indices. Returns null when nothing maps — the apply
 *  action then leaves the default view untouched (curves recall is partial,
 *  so "no selection" must stay graceful, never an empty plot). */
export function figureChannelSelection(
  figure: OriginFigure,
  ds: Dataset,
): { xKey: number | null; yKeys: number[] } | null {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const book = String(meta.origin_book ?? "");
  const letters = Array.isArray(meta.origin_column_names)
    ? (meta.origin_column_names as unknown[]).map(String)
    : null;
  if (!letters) return null;
  const mine: OriginCurve[] = (figure.curves ?? []).filter((c) => c.book === book);
  if (mine.length === 0) return null;
  const xLetter = String(meta.x_column_name ?? "");
  const yKeys: number[] = [];
  let xKey: number | null = null;
  for (const curve of mine) {
    const yIdx = letters.indexOf(curve.y);
    if (yIdx < 0) continue; // e.g. a text/dropped column — skip, never guess
    if (!yKeys.includes(yIdx)) yKeys.push(yIdx);
    if (curve.x && curve.x !== xLetter) {
      const xIdx = letters.indexOf(curve.x);
      if (xIdx >= 0) xKey = xIdx; // plot against a non-default x channel
    }
  }
  return yKeys.length > 0 ? { xKey, yKeys } : null;
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

/** The other layer's entry when `entry` is one half of a genuine Origin
 *  "double-Y" pair: same import (stem), same graph-window name, EXACTLY 2
 *  layer-entries share that name (rules out >2-layer composite/panel
 *  windows, which reuse the same multi-layer mechanism for a structurally
 *  different layout — see `figures.py`'s module docstring), both already
 *  resolved to the SAME dataset, and both carrying at least one decoded
 *  curve (partial recall must degrade, never guess). When all of that
 *  holds, `useApp.applyOriginFigure` can offer the combined view — layer-1
 *  curves on y, layer-2 curves on y2 — instead of just the clicked layer's
 *  own curves. Returns null for everything else: single-layer figures,
 *  cross-book pairs, or missing curve recall. */
export function doubleYPartner(
  entry: OriginFigureEntry,
  all: OriginFigureEntry[],
): OriginFigureEntry | null {
  const name = entry.figure.name;
  if (!name) return null;
  // Same import (siblingIds[0] is the import key), same graph-window name.
  // Scoping to the import stops two imports of a same-named file from inflating
  // the family past 2 and disabling the double-Y offer.
  const key = entry.siblingIds[0];
  const family = all.filter(
    (e) => e.stem === entry.stem && e.figure.name === name && e.siblingIds[0] === key,
  );
  if (family.length !== 2) return null;
  const partner = family.find((e) => e.id !== entry.id);
  if (!partner) return null;
  if (!entry.datasetId || !partner.datasetId) return null;
  if (entry.datasetId !== partner.datasetId) return null;
  if ((entry.figure.curves ?? []).length === 0) return null;
  if ((partner.figure.curves ?? []).length === 0) return null;
  return partner;
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
