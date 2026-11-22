// The async step in front of `figureSpec.buildFigureSpecFromDocument` for a
// saved DISPLAY curve (a large Curve Fit, lib/fitCurve): the document keeps only
// the thinned picture plus where its full resolution comes from, and the sync
// builder leaves such a fit out with the "saved fit left out" notice. A Figure
// Page panel, a batch export and a Library multi-figure PDF call
// `withFullSavedFit` first: it fetches the full curve (by resultId; on an
// evicted id `fullFitCurve` evaluates the model at the fitted rows' x, the
// existing fallback) and returns a copy of the document whose saved fit is that
// full curve. Fails closed: when anything is unreadable, stale or the fetch
// fails, the document comes back UNCHANGED and the builder leaves the fit out
// with its notice as before. The row-key check stays with the builder
// (`overlays.rows` is untouched), so a changed dataset still drops the fit.
// Lazy: the cheap check below is all an eager caller pays; the rest is imported
// on use.

import type { FigureDocument } from "./figureDocument";
import type { Dataset } from "./types";

/** Does `doc` carry a saved display curve (one that needs fetching)? */
export const hasSavedDisplayFit = (doc: FigureDocument): boolean => Boolean(doc.overlays?.fit?.full);

/** `doc` with its saved display fit swapped for the full curve (a copy), else
 *  `doc` itself. Never throws. `dataset` is the live dataset the document
 *  renders (ignored for a frozen document, which renders its own snapshot). */
export async function withFullSavedFit(
  doc: FigureDocument,
  dataset: Dataset | null | undefined,
  staleFits?: readonly string[],
): Promise<FigureDocument> {
  if (!hasSavedDisplayFit(doc)) return doc;
  try {
    const [{ fitFromDocument }, { fullFitOverlay }, { resolveFigureDocumentData }] = await Promise.all([
      import("./figureOverlays"),
      import("./fitCurve"),
      import("./figureSpec"),
    ]);
    const data = resolveFigureDocumentData(doc, dataset).data;
    const ds: Dataset = doc.data.mode === "live" && dataset
      ? dataset
      : { id: doc.bindings.datasetId ?? doc.id, name: doc.name, data, channelRoles: undefined };
    if (staleFits?.includes(ds.id)) return doc; // never drawn: nothing to fetch
    const saved = fitFromDocument(doc.overlays, ds);
    if (!saved?.full) return doc; // does not align to the rows, or unreadable
    const full = await fullFitOverlay(saved);
    const y = full.y.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
    const { full: _source, ...fit } = doc.overlays!.fit!;
    return { ...doc, overlays: { ...doc.overlays!, fit: { ...fit, y } } };
  } catch {
    return doc;
  }
}
