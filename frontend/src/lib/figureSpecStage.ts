// Stage copy/export's entry point into the publication path — extracted from
// lib/figureSpec.ts (BUG-016 round 5, review F9) when that module reached one
// line of headroom under the repo's 500-line ceiling. The seam is the one the
// module header there already describes: `figureSpec.ts` BUILDS a spec from a
// view or from a canonical document, and this file decides WHICH of the two a
// Stage command should get. Nothing else moved with it.
//
// Imported directly by its callers (`lib/copyFigureCommand.ts`,
// `lib/exportFigureCommand.ts`) rather than re-exported from `figureSpec.ts`:
// this module imports that one, so a barrel there would close a cycle and put
// the Stage routing into the graph of every importer of the builders.

import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { buildFigureSpec, buildFigureSpecFromDocument, type FigureRenderOpts } from "./figureSpec";
import { windowCyclesSeriesStyles } from "./seriesStyleCycle";
import type { Dataset } from "./types";
import { readLiveWaterfallSpan } from "./waterfallOffset";

/** Stage copy/export entry point (F2.5b). Every Stage command that renders
 *  "the active dataset" (Copy figure, Copy figure (vector), Export figure…)
 *  must derive from the SAME canonical document the focused plot window
 *  carries, per F2.5's contract — not reassemble a reduced spec from the
 *  live `PlotView` singleton, which cannot represent grouping, axis breaks,
 *  or publication overrides/series styles at all (see the module header).
 *
 *  Routes through `buildFigureSpecFromDocument` when the FOCUSED window is a
 *  `kind:"plot"` window (the only kind `focusedWindowId` ever names — see
 *  `PlotWindow`'s doc in lib/plotview.ts) whose document is either:
 *   - bound to `ds`, the resolved active dataset every Stage command already
 *     exports (the common case: `AppState.activeId` is documented to always
 *     equal the focused window's bound dataset), or
 *   - frozen — a frozen document ignores whatever dataset is passed
 *     (`resolveFigureDocumentData` renders its own snapshot regardless) and
 *     is reachable here via `openEditableFigure` opening a frozen editable
 *     figure into a window; F3.6's page-panel "window" branch already routes
 *     a frozen-or-live window document through this same adapter
 *     unconditionally, so this matches established precedent.
 *
 *  Falls back to `buildFigureSpec` (the live-view builder) otherwise:
 *   - no focused window, the focused window isn't `kind:"plot"`, or it has no
 *     document yet — none of these should occur for a FOCUSED Stage window in
 *     practice (every real window has carried a document since F1, and only a
 *     `kind:"plot"` window can hold focus), but the fallback is the safe
 *     response to an invariant violation, not a crash. `buildFigureSpec` is
 *     reached ONLY through this fallback in production (grep) — a test that
 *     calls it directly, as round 3's own new test did, exercises this rare
 *     branch, not the `buildFigureSpecFromDocument` route real exports take
 *     (exactly how round 3 marked a group_col degrade "closed" on a branch
 *     users do not reach — round 4 review);
 *   - a LIVE document whose `bindings.datasetId` disagrees with `ds.id` —
 *     the one case this guard actively defends: `exportActive` resolves
 *     `ds` from `activeId` BEFORE an async `resolveDataset()`, during which
 *     the user can refocus to a different window bound to a different
 *     dataset; falling back keeps the export honest to `ds` rather than
 *     silently pairing the new focus's styling with the old dataset.
 *
 *  `o`'s dialog/copy-default choices always win over anything saved on the
 *  document — every field `FigureRenderOpts` carries maps directly onto
 *  `FigureDocumentRenderOpts`, a superset. `filename: null` keeps the
 *  dataset stem naming the file (Stage's existing convention), never the
 *  document's own saved output filename. `extra.transparent` is applied
 *  LAST, after either builder runs, so a caller's transparency preference
 *  (Copy figure's `copyFigureTransparent`) wins even on the fallback path,
 *  matching this function's callers' pre-F2.5b behavior of spreading it
 *  onto the built spec themselves. */
export function buildStageFigureSpec(
  s: StoreGet,
  ds: Dataset,
  stem: string,
  o: FigureRenderOpts,
  extra: { transparent?: boolean } = {},
): FigureSpec {
  const st = s();
  const focused = st.windowsForSave().find((w) => w.id === st.focusedWindowId);
  const document = focused && focused.kind === "plot" ? focused.document : undefined;
  const canRouteThroughDocument =
    document !== undefined &&
    (document.data.mode === "frozen" || document.bindings.datasetId === ds.id);
  // P3.3: this is THE export the focused Stage canvas produces — Copy figure,
  // Copy figure (vector), Export figure… — so it is the one entry point that
  // opts into the auto dash/marker cycle. It asks `windowCyclesSeriesStyles`,
  // literally the call `Stage/useStageSeriesCycle` makes for that same canvas,
  // so screen and PDF cycle together or not at all.
  // Asked against the LIVE view (`st` satisfies `CycleView`) as well as the
  // rendered one: the document this may route through carries its own copy of
  // the view, and only the live singleton is guaranteed to be what PlotStage is
  // drawing right now. The document refusal matters here too, because the
  // FALLBACK branch below (a live-view spec, which never sees
  // `document.publication`) would otherwise cycle while the canvas — which reads
  // the pin straight off the focused window — refuses.
  const autoSeriesStyles = windowCyclesSeriesStyles(st.autoSeriesStyles, st, document);
  // BUG-013 review round: the y-span the FOCUSED canvas actually measured its
  // waterfall stagger from — the one thing about this export that cannot be
  // re-derived from `ds`, because a committed zoom on a server-decimated
  // dataset narrows the canvas' own payload to the visible x-window while `ds`
  // still holds every row (see lib/waterfallOffset.ts's header). Read at
  // command time from the module-scope seam `Stage/useLiveSnapshotPublish`
  // writes, the same shape `lib/plotsnapshot.ts` uses for the display bundle,
  // and keyed by dataset so the documented refocus race below cannot stagger
  // one dataset by another's span. `null` (no XY canvas on screen, or one
  // showing a different dataset) falls back to the full DataStruct.
  const waterfallSpan = readLiveWaterfallSpan(ds.id);
  const spec = canRouteThroughDocument
    ? buildFigureSpecFromDocument(document, ds, stem, {
        fmt: o.fmt,
        style: o.style,
        dpi: o.dpi,
        title: o.title,
        xLabel: o.xLabel,
        yLabel: o.yLabel,
        filename: null,
        autoSeriesStyles,
        waterfallSpan,
        greyscale: o.greyscale,
      })
    : buildFigureSpec(s, ds, stem, o, { autoSeriesStyles, waterfallSpan });
  return extra.transparent === undefined ? spec : { ...spec, transparent: extra.transparent };
}
