// Import-time construction of the Library's Origin figure entries: match each
// imported figure snapshot (`figures.extract_figures`) to the dataset its
// import created. Split from `./originFigures` (its eager half) because only
// the lazy import path (`store/importDatasets.ts`) calls it; a static import
// from an eagerly reachable file would fold it back into the entry chunk.

import type { OriginFigureEntry } from "./originFigures";
import type { Dataset, OriginFigure } from "./types";

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
