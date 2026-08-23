// The Publication Preview's Export commit: canonical (FigureDocument) export
// when a publication session is open, else the legacy live-plot spec.
// Extracted from useFigureBuilder.ts's `exportNow` to fund F2.3g's channel-
// membership wiring -- the dispatch needs only injected state plus a couple
// of API calls, the same shape previewDrag.ts's dragPreviewElement already
// established for this hook's size pin. The hook keeps a thin
// closure-binding wrapper; behavior stays exercised through the hook's own
// export tests.

import { exportFigure, type FigureSpec } from "../../../lib/api/figures";
import type { CanonicalReadiness } from "./canonicalReadiness";
import type { FigureDocument } from "../../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../../lib/figureSpec";
import type { DataStruct, Dataset } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

/** The live state an export commit reads -- bound by the hook. */
export interface PreviewExportDeps {
  canonicalDocument: FigureDocument | null;
  canonicalReadiness: CanonicalReadiness | null;
  canonicalDataset: Dataset | null;
  spec: FigureSpec | null;
  frozenData: DataStruct | null;
  active: Dataset | null;
  fmt: string;
  dpi: number;
  setStatus: (status: string) => void;
}

/** Export the current figure: the canonical FigureDocument when a
 *  publication session is open, else the legacy live-plot spec. Both paths
 *  resolve a still-pending dataset before exporting (#38) so the request
 *  never silently ships the small preview subset. */
export async function exportPreviewFigure(deps: PreviewExportDeps): Promise<void> {
  const { canonicalDocument, canonicalReadiness, canonicalDataset, spec, frozenData, active, fmt, dpi, setStatus } = deps;
  if (canonicalDocument) {
    if (canonicalReadiness?.state !== "ready") {
      const msg = `export unavailable: ${canonicalReadiness?.error ?? "figure is not ready"}`;
      toast(msg, "danger");
      setStatus(msg);
      return;
    }
    try {
      let dataset = canonicalDataset;
      if (dataset?.pending) dataset = (await useApp.getState().resolveDataset(dataset.id)) ?? null;
      const stem = (dataset?.name ?? canonicalDocument.name).replace(/\.[^.]+$/, "");
      await exportFigure({ ...buildFigureSpecFromDocument(canonicalDocument, dataset, stem), filename: stem });
      setStatus(`exported ${stem}.${canonicalDocument.output.format}`);
    } catch (e) {
      const msg = `export failed: ${e instanceof Error ? e.message : "error"}`;
      toast(msg, "danger");
      setStatus(msg);
    }
    return;
  }
  if (!spec) return;
  try {
    // #38 deferred edge: a LIVE (non-frozen) spec tracks the active
    // dataset -- resolve its full data first rather than silently exporting
    // the small preview. A frozen doc's dataSnapshot is untouched (it was
    // deliberately captured as-is).
    let dataset = spec.dataset;
    if (!frozenData && active?.pending) {
      const ds = await useApp.getState().resolveDataset(active.id);
      if (ds) dataset = ds.data;
    }
    const stem = (active?.name ?? "figure").replace(/\.[^.]+$/, "");
    await exportFigure({ ...spec, dataset, fmt, dpi, filename: stem });
    setStatus(`exported ${stem}.${fmt}`);
  } catch (e) {
    setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`);
  }
}
