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
import { buildLegacyFigureSpec, type LegacyFigureState } from "./legacyFigure";
import type { FigureDocument } from "../../../lib/figureDocument";
import { chooseExcludedRows } from "../../../lib/excludedRowsChoice";
import { excludedChoiceMatters } from "../../../lib/excludedRowsExport";
import { figureRevision } from "../../../lib/figureRevision";
import { withFullSavedFit } from "../../../lib/figureSavedFit";
import { buildFigureSpecFromDocument } from "../../../lib/figureSpec";
import type { LiveTickSteps } from "../../../lib/liveTickSteps";
import { withLiveTickHints } from "../../../lib/liveTickStepsSpec";
import { overlayDropTracker, withDropNote } from "../../../lib/overlayDropNotice";
import type { DataStruct, Dataset } from "../../../lib/types";
import { runCancellable } from "../../../store/pendingOpActions";
import { withExportPrefs } from "../../../lib/exportPrefs";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

/** The live state an export commit reads -- bound by the hook. */
export interface PreviewExportDeps {
  canonicalDocument: FigureDocument | null;
  canonicalReadiness: CanonicalReadiness | null;
  canonicalDataset: Dataset | null;
  spec: FigureSpec | null;
  /** The legacy request's inputs, rebuilt at export time over the resolved
   *  dataset, once greyed and once omitted (F4.2c (a)). */
  legacyState: LegacyFigureState;
  frozenData: DataStruct | null;
  active: Dataset | null;
  fmt: string;
  dpi: number;
  /** P3.3: opt IN to the auto dash/marker cycle — true for a session whose
   *  TARGET window cycles per `windowCyclesSeriesStyles`, focused or not, so
   *  this Export emits the same dashes that window's Stage export (and its
   *  canvas) shows. Sourced from
   *  `canonicalSession.selectSessionCyclesSeriesStyles`. */
  autoSeriesStyles: boolean | number;
  /** The focused canvas' increments, for a session on that window (canonicalSession.sessionTickHints). */
  tickHints?: LiveTickSteps | null;
  setStatus: (status: string, tone?: "ok" | "danger") => void;
}

/** P3.4 safe cancel: each path is one StatusBar op whose Cancel aborts the
 *  render request, so a cancelled export saves no file and raises no error
 *  toast; it leaves this status line instead. */
const EXPORT_LABEL = "Exporting figure…";
const CANCELLED = "export cancelled";

/** Remember the draft just exported on its (still open) session, so closing
 *  the view right afterwards does not ask to discard it (UX-H). */
function markExported(document: FigureDocument): void {
  const session = useApp.getState().figurePublicationSession;
  if (session?.draft === document) useApp.setState({ figurePublicationSession: { ...session, exported: document } });
}

/** Export the current figure: the canonical FigureDocument when a
 *  publication session is open, else the legacy live-plot spec. Both paths
 *  resolve a still-pending dataset before exporting (#38) so the request
 *  never silently ships the small preview subset. */
export async function exportPreviewFigure(deps: PreviewExportDeps): Promise<void> {
  const { canonicalDocument, canonicalReadiness, canonicalDataset, spec, legacyState, frozenData, active, fmt, dpi, autoSeriesStyles, setStatus } = deps;
  if (canonicalDocument) {
    if (canonicalReadiness?.state !== "ready") {
      const msg = `export unavailable: ${canonicalReadiness?.error ?? "figure is not ready"}`;
      toast(msg, "danger");
      setStatus(msg);
      return;
    }
    // The revision is fixed HERE, at the click: the file is built from this document, and the
    // confirmation names it, even if the plot moves while the render is in flight.
    const revision = figureRevision(canonicalDocument);
    try {
      const done = await runCancellable(EXPORT_LABEL, async (signal) => {
        let dataset = canonicalDataset;
        if (dataset?.pending) dataset = (await useApp.getState().resolveDataset(dataset.id)) ?? null;
        signal.throwIfAborted();
        // A saved display fit is swapped for its full curve first (lib/figureSavedFit); failed, the
        // document is unchanged and the builder leaves the fit out with its notice (fail closed).
        const document = await withFullSavedFit(canonicalDocument, dataset, useApp.getState().staleFits);
        signal.throwIfAborted();
        const stem = (dataset?.name ?? canonicalDocument.name).replace(/\.[^.]+$/, "");
        // An overlay the figure cannot carry is reported, never dropped
        // silently (lib/overlayDropNotice — the quick dialog's own notice).
        const drops = overlayDropTracker();
        // F4.2c (a): a figure with excluded rows asks "greyed or omitted?".
        const picked = await chooseExcludedRows(
          (greyExcluded) => drops.build((onDroppedOverlays) => withLiveTickHints(buildFigureSpecFromDocument(document, dataset, stem, {
            autoSeriesStyles, greyExcluded, defaultTrace: useApp.getState().defaultTrace,
            defaultLineWidth: useApp.getState().defaultLineWidth, staleFits: useApp.getState().staleFits, onDroppedOverlays,
          }), deps.tickHints)),
          excludedChoiceMatters,
          useApp.getState().excludedDisplay,
        );
        if (!picked) return null;
        await exportFigure(withExportPrefs({ ...picked.value, filename: stem }), signal);
        markExported(canonicalDocument);
        return { stem, note: drops.note(picked.value) };
      });
      const msg = done?.value ? withDropNote(`exported ${done.value.stem}.${canonicalDocument.output.format} (revision ${revision})`, done.value.note) : CANCELLED;
      if (done?.value?.note) toast(msg, "info");
      setStatus(msg);
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
    const stem = (active?.name ?? "figure").replace(/\.[^.]+$/, "");
    const done = await runCancellable(EXPORT_LABEL, async (signal) => {
      let state = legacyState;
      if (!frozenData && active?.pending) {
        const ds = await useApp.getState().resolveDataset(active.id);
        if (ds) state = { ...state, data: ds.data, liveDataset: state.liveDataset ? ds : null };
      }
      signal.throwIfAborted();
      // F4.2c (a): a figure with excluded rows asks "greyed or omitted?".
      const picked = await chooseExcludedRows(
        (greyExcluded) => buildLegacyFigureSpec(state, greyExcluded),
        (grey, omit) => !!grey && !!omit && excludedChoiceMatters(grey, omit),
        useApp.getState().excludedDisplay,
      );
      if (!picked?.value) return false;
      await exportFigure(withExportPrefs({ ...picked.value, fmt, dpi, filename: stem }), signal);
      return true;
    });
    setStatus(done?.value ? `exported ${stem}.${fmt}` : CANCELLED);
  } catch (e) {
    setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`, "danger");
  }
}
