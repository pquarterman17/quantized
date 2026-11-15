// A figure DOCUMENT's saved analysis overlays (lib/figureOverlays.ts) on its
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
import { liveOverlaysFromDocument, overlayKinds } from "./figureOverlays";
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
}

/** The wire label each saved kind travels under (lib/figureSpecOverlays). */
const WIRE_LABEL = { fit: FIT_SERIES_LABEL, baseline: "baseline", peaks: "peaks" } as const;

/** `spec` with `doc`'s saved overlays appended, drawn against `data` --
 *  the rows the spec was built from (`dataset` for a live document, its
 *  snapshot for a frozen one). `view` is the PlotView the spec was built from. */
export function withDocumentOverlays(
  spec: FigureSpec,
  doc: FigureDocument,
  dataset: Dataset | null | undefined,
  data: DataStruct,
  view: PlotView,
  opts: DocumentOverlayOpts,
): FigureSpec {
  const saved = doc.overlays;
  if (!saved) return spec;
  // A frozen document renders its own snapshot: no live rows are excluded there.
  const ds: Dataset = doc.data.mode === "live" && dataset
    ? dataset
    : { id: doc.bindings.datasetId ?? doc.id, name: doc.name, data, channelRoles: undefined };
  const live = liveOverlaysFromDocument(saved, ds.id, data);
  const sources = {
    fitOverlay: live.fitOverlay ?? null,
    baselineOverlay: live.baselineOverlay ?? null,
    peakOverlay: live.peakOverlay ?? null,
    defaultTrace: opts.defaultTrace,
    defaultLineWidth: opts.defaultLineWidth,
  };
  const placed = placeAnalysisOverlays(spec, ds, view, sources, { screen: opts.greyed, wire: opts.greyed });
  const carried = new Set(placed.spec.dataset.labels.slice(spec.dataset.labels.length));
  const dropped = overlayKinds(saved).map((kind) => WIRE_LABEL[kind]).filter((label) => !carried.has(label));
  if (dropped.length) opts.onDropped?.(dropped);
  return placed.spec;
}

const KIND_NAMES: Record<string, string> = { [FIT_SERIES_LABEL]: "fit", baseline: "baseline", peaks: "peak markers" };

/** The status line for a saved figure whose overlays were left out. */
export function savedOverlaysDroppedNotice(name: string, labels: readonly string[]): string {
  const names = labels.map((label) => KIND_NAMES[label] ?? label).join(", ");
  return `"${name}": saved ${names} left out (its data changed since it was saved, its curve is hidden, or the view splits series)`;
}
