// Plot ▸ Export figure… (UX-H): which export surface a figure opens in, and
// the two openers. Moved out of commands/fileCommands.ts so other "Export"
// buttons (Graph Builder's) open the very same view without depending on the
// command registry. Pure store orchestration; the dialog body stays lazy.

import { createFigureDocument } from "./figureDocument";
import type { StoreGet } from "./exportActive";
import { effectiveChannels } from "./plotdata";
import { snapshotView } from "./plotview";
import { frontPlotWindowId, routeFigureTarget } from "./figureTarget";
import { offerMapExport } from "./publicationPreviewMap";
import { onLoadFailure, runLazy } from "./runLazy";
import "../store/figureLifecycleReady";

// Body lives in lib/exportFigureCommand (store-size ratchet offset for
// MAIN_PLAN #16's Append workspace command — see that file's doc).
// Bundle: click-only — dynamic import keeps lib/exportFigureCommand
// (and the figureSpec transport builder behind it) off the eager path.
// runLazy (F5) — see that function's own doc.
/** The quick (no-preview) Export figure dialog. Resolves once it is done. */
export function runQuickExport(s: StoreGet): Promise<void> {
  return runLazy("Loading figure export…", () => import("./exportFigureCommand"))
    .then((m) => m.runExportFigureCommand(s), onLoadFailure);
}
/** How the export view was opened, so its window is titled to match: Plot ▸
 *  Export figure… says "Export figure", every other opener the "Publication
 *  preview" it always was. Read once per open; the view resets it on close. */
let viewLabel = "Publication preview";
export const getFigureViewLabel = (): string => viewLabel;
export const resetFigureViewLabel = (): void => { viewLabel = "Publication preview"; };

/** Plot ▸ Publication preview…: a session on the focused plot window, else a
 *  detached draft of the active dataset's on-screen view. */
export function openPublicationPreview(s: StoreGet, label = "Publication preview"): void {
  const wasOpen = s().figureBuilderOpen;
  if (!wasOpen) viewLabel = label;
  openPreview(s);
  if (!wasOpen && !s().figureBuilderOpen) resetFigureViewLabel(); // refused: the next opener must not inherit it
}
/** Plot ▸ Publication preview…: previews the window the user is working in, resolved the way Export figure… does
 *  (lib/figureTarget). A plot in front is previewed (it takes the focus the preview edits through); a map in front
 *  offers its own Export map (publicationPreviewMap.ts) and runs nothing itself; a worksheet, snapshot or panel in front, or no window, is refused with the shared reason. */
export function runPublicationPreview(s: StoreGet): void {
  if (offerMapExport(s)) return;
  if (routeFigureTarget(s, "export")) return;
  const front = frontPlotWindowId(s());
  if (front !== null && front !== s().focusedWindowId && !s().figurePublicationSession) s().focusWindow(front);
  openPublicationPreview(s);
}
function openPreview(s: StoreGet): void {
  if (s().figurePublicationSession) {
    s().setStatus("finish or cancel the current Publication Preview before opening another");
    return;
  }
  if (s().beginFigurePublicationEdit()) return;
  // F2.1e: no focused plot window. With no active dataset either, this
  // degrades exactly as before -- the legacy FigureBuilderView opens
  // with nothing to show ("Select a dataset to preview a figure.").
  // With an active dataset, open the SAME detached canonical session
  // Graph Builder's openInFigureBuilder uses
  // (beginDetachedFigurePublicationEdit), synthesized from the active
  // dataset + the live on-screen view (snapshotView mirrors channels,
  // scales, styles, decor) rather than the old legacy-mode preview --
  // so Apply now creates a new editable figure instead of being a dead
  // end.
  const state = s();
  const active = state.datasets.find((dataset) => dataset.id === state.activeId);
  if (!active) {
    s().setStatus("no plot window is focused — previewing the active dataset; Apply is unavailable in this mode");
    s().setFigureBuilderOpen(true);
    return;
  }
  const draft = createFigureDocument({
    id: `figure-preview-${active.id}`,
    name: active.name,
    datasetId: active.id,
    view: snapshotView(state),
  });
  if (s().beginDetachedFigurePublicationEdit(draft)) {
    s().setStatus(
      `no plot window is focused — previewing "${active.name}"; Apply will save it as a new editable figure`,
    );
  }
}

/** Plot ▸ Export figure… (UX-H): the one export view — the Publication
 *  preview, with its large true-size preview. A view that preview cannot draw
 *  (stat, polar, a per-channel stack, a spatial page) keeps the quick dialog,
 *  which exports those — as does no dataset at all (it refuses with a reason).
 *  So does a waterfall: the Stage export staggers by the span the live canvas
 *  measured (lib/waterfallOffset's seam; a zoomed, server-thinned canvas
 *  differs from the full data), which the document-built preview cannot see,
 *  so preview and file could disagree.
 *  Resolves once the quick dialog (when used) is done. */
export function runExportFigureView(s: StoreGet, opts: { ownPlot?: boolean } = {}): Promise<void> {
  // The window the user is working in decides (lib/figureTarget); Graph Builder exports the plot it just applied to.
  if (!opts.ownPlot && routeFigureTarget(s, "export")) return Promise.resolve();
  const st = s();
  const active = st.datasets.find((d) => d.id === st.activeId);
  // PlotStage's stack gate (`multiPanelShowing`): a stack draws panels only
  // with two or more plotted channels; one channel is an ordinary plot.
  const plotted = active ? effectiveChannels(active.data, st.yKeys, st.xKey, active.channelRoles, st.seriesOrder).length : 0;
  const stack = st.stackMode && st.composition === null && st.facetKey === null && plotted >= 2;
  const waterfall = st.waterfall !== 0 || st.waterfallDx !== 0;
  if (st.figurePublicationSession) {
    st.setFigureBuilderOpen(true);
    st.setStatus("the export view is already open — finish or cancel it to export another figure");
    return Promise.resolve();
  }
  if (!active || st.statMode || st.polarMode || stack || waterfall || st.composition?.kind === "spatial") return runQuickExport(s);
  openPublicationPreview(s, "Export figure");
  return Promise.resolve();
}
