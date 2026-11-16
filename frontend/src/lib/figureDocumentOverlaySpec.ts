// A figure DOCUMENT's saved fit curve (lib/figureOverlays.ts) on its
// export request: the one step `figureSpec.buildFigureSpecFromDocument` takes
// after building, so a Figure Page panel, a batch / Library multi-figure PDF,
// Send to report and the Figure Builder preview all draw a saved figure's fit
// exactly as its canvas did. The drawing itself is lib/figureSpecOverlays' --
// the SAME placement, palette slot, band fill and decade offset the Stage export
// uses for the live overlays -- so screen and every export agree.
//
// Fails closed: a section whose rows no longer hash the same as the data the
// document renders, and any curve placement refuses (bound Y hidden or no
// longer a curve on its X, a split / encoded / faceted request), is left out
// and named to `onDropped`; never re-aligned or guessed.
// Lazy: imported only by lib/figureSpec.ts (an export-path module).

import type { FigureSpec } from "./api/figures";
import type { FigureDocument } from "./figureDocument";
import { backgroundFromDocument, fitFromDocument, sanitizeFigureOverlays } from "./figureOverlays";
import { placeAnalysisOverlays } from "./figureSpecOverlays";
import { FIT_SERIES_LABEL } from "./overlaySpecShape";
import type { PlotView } from "./plotview";
import type { Dataset, DataStruct, DefaultTrace } from "./types";

export interface DocumentOverlayOpts {
  defaultTrace?: DefaultTrace;
  defaultLineWidth?: number;
  /** The export greys excluded rows (its "(excluded)" companions ride the wire). */
  greyed: boolean;
  onDropped?: (labels: string[]) => void;
  /** Datasets whose saved fit is out of date (`AppState.staleFits`): passed in
   *  by the caller (review L7), so this module stays pure. */
  staleFits?: readonly string[];
}

/** `spec` with `doc`'s saved fit appended, drawn against `data` -- the rows
 *  the spec was built from (`dataset` for a live document, its snapshot for a
 *  frozen one). `view` is the PlotView the spec was built from. An unreadable
 *  section is ignored here (the load drops it once, with a notice). */
export function withDocumentOverlays(
  spec: FigureSpec,
  doc: FigureDocument,
  dataset: Dataset | null | undefined,
  data: DataStruct,
  view: PlotView,
  opts: DocumentOverlayOpts,
): FigureSpec {
  if (!doc.overlays) return spec;
  if (!sanitizeFigureOverlays(doc.overlays)) {
    opts.onDropped?.([FIT_SERIES_LABEL]); // unreadable: said, not silently skipped (review N1)
    return spec;
  }
  // A frozen document renders its own snapshot: no live rows are excluded there.
  const ds: Dataset = doc.data.mode === "live" && dataset
    ? dataset
    : { id: doc.bindings.datasetId ?? doc.id, name: doc.name, data, channelRoles: undefined };
  // A fit marked stale (its source changed after it ran) is drawn nowhere --
  // the focused canvas and a background window refuse it the same way.
  const stale = opts.staleFits?.includes(ds.id) ?? false;
  const fit = stale ? null : fitFromDocument(doc.overlays, ds);
  const sources = {
    fitOverlay: fit,
    // A Peak Analyzer fit's fitted background goes with its fit (review N9).
    baselineOverlay: backgroundFromDocument(doc.overlays, ds, fit),
    peakOverlay: null,
    defaultTrace: opts.defaultTrace,
    defaultLineWidth: opts.defaultLineWidth,
  };
  const placed = placeAnalysisOverlays(spec, ds, view, sources, { screen: opts.greyed, wire: opts.greyed });
  if (!placed.spec.dataset.labels.slice(spec.dataset.labels.length).includes(FIT_SERIES_LABEL)) opts.onDropped?.([FIT_SERIES_LABEL]);
  return placed.spec;
}

/** The status line for a saved figure whose fit was left out. */
export function savedOverlaysDroppedNotice(name: string, _labels: readonly string[]): string {
  return `"${name}": saved fit left out (its data or excluded rows changed since it was saved, its curve is hidden, or the view splits series)`;
}
