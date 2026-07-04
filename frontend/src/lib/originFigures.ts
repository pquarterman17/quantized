// Resolve Origin figure snapshots (`figures.extract_figures`, plan item 18)
// against the datasets created by the same import, and describe how to
// display one in the Library. Pure/store-agnostic so the matching heuristic
// is unit-testable without mounting the store — `store/useApp.ts` owns the
// actual apply-to-plot-state action.

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
  return figures.map((figure, i) => ({
    id: `fig-${stem}-${i}`,
    stem,
    figure,
    datasetId: resolveFigureDataset(figure, candidates),
  }));
}

/** Library row label: prefer a surviving annotation (reads like a plot title
 *  or peak label) over the raw Origin graph-window name (e.g. "Graph3"). */
export function figureLabel(entry: OriginFigureEntry): string {
  const f = entry.figure;
  return f.annotations[0] || f.name || "Figure";
}
