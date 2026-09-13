// The ONE builder that turns the live on-screen plot state into a backend
// FigureSpec — extracted from exportFigureCommand.ts (MAIN_PLAN #35) so that
// "Export figure…" and "Copy figure" render through the SAME publication path
// instead of drifting apart.
//
// That shared path is the whole point of #35. Copy previously composited the
// uPlot canvas at screen resolution, so a pasted figure and an exported one
// disagreed on fonts, line widths, tick formats, limits, legend placement and
// multi-panel layout. Both now build this spec and post it to
// /api/export/figure; only the output verb differs (download vs clipboard).
// Do NOT add a third rendering implementation — extend this one.
//
// F2.5b (FIGURE_AUTHORING_WORKFLOW_PLAN): `buildFigureSpec` derives from the
// live `PlotView` singleton, which structurally cannot represent grouping,
// axis breaks, or publication overrides/series styles — PlotView has no
// fields for them. `buildStageFigureSpec` is Stage copy/export's entry
// point: it prefers the FOCUSED window's canonical `FigureDocument` (which
// carries all three, via `buildFigureSpecFromDocument`) and falls back to
// `buildFigureSpec` only when no canonical document applies — see its own
// doc for the exact fallback conditions.

import {
  resolveSecondaryAxis,
  secondaryAxisFromView,
  secondaryAxisIsLog,
  secondaryAxisWire,
} from "./axisspec";
import type { ErrorPair } from "./api";
import type { FigureSpec } from "./api/figures";
import { buildErrorSpans } from "./errorbars";
import { buildExportStyles } from "./exportStyles";
import type { StoreGet } from "./exportActive";
import { figureDocumentToPlotView, type FigureDocument } from "./figureDocument";
import { resolveFacetsOrThrow } from "./figureSpecFacets";
import {
  compactOverrides,
  gateY2Overrides,
  mergeFigureOverrides,
  type FigureOverrides,
} from "./figureOverrides";
import { marginFractions, pageSizeInches } from "./pagesetup";
import { effectiveChannels } from "./plotdata";
import type { PlotView } from "./plotview";
import { pruneToLiveDataset } from "./rowstate";
// The screen-parity override projection moved to lib/figureViewOverrides.ts to
// fund P3.3's threading against this file's 500-line ceiling. Imported, NOT
// re-exported: a barrel here would make every importer of this module pull the
// projection in whether it uses it or not.
import { viewOverrides } from "./figureViewOverrides";
import { overlayExportsSeriesStyles, windowCyclesSeriesStyles } from "./seriesStyleCycle";
import type { ErrorBinding } from "./errorRoles";
import type { Dataset, DataStruct } from "./types";
import { axisFmtParam } from "./types";

/** The render-time choices a caller supplies. Everything else about the spec
 *  is derived from live view state, so the two callers cannot diverge on it. */
export interface FigureRenderOpts {
  fmt: string;
  style: string;
  dpi: number;
  title: string;
  /** Blank/undefined = derive the label from the data column. */
  xLabel?: string;
  yLabel?: string;
}

/** Optional publication choices layered over a FigureDocument's saved output
 * settings. Labels and title default to the document's PlotView; `filename`
 * defaults to the document output filename, then the caller's export stem. */
export interface FigureDocumentRenderOpts extends Partial<FigureRenderOpts> {
  transparent?: boolean;
  filename?: string | null;
  /** P3.3: opt IN to the auto dash/marker cycle. Passed by the two producers
   *  that render a document WHOSE LIVE CANVAS IS ON SCREEN and cycling —
   *  `buildStageFigureSpec` (the focused window's Copy/Export) and the Figure
   *  Builder's preview + Export for a `window`-target session
   *  (`figurebuilder/canonicalSession.selectSessionCyclesSeriesStyles`). A
   *  document rendered with no canvas beside it (a Figure Page panel, a graph
   *  template, a saved Library figure) is uncycled — which is what keeps a saved
   *  document's styles the RAW user styles and stops it disagreeing with itself
   *  when the preference is later flipped. */
  autoSeriesStyles?: boolean;
}

/** Resolve the data that a canonical document is allowed to render. A frozen
 * document is self-contained and intentionally ignores any live dataset. A
 * live document must name, and be given, its exact bound dataset: accepting a
 * different one would silently export the right styling against wrong data. */
export function resolveFigureDocumentData(
  document: FigureDocument,
  dataset?: Dataset | null,
): { data: DataStruct; channelRoles?: Dataset["channelRoles"] } {
  if (document.data.mode === "frozen") {
    if (!document.data.snapshot) throw new Error("frozen figure document has no data snapshot");
    return { data: structuredClone(document.data.snapshot) };
  }
  if (document.bindings.datasetId === null) throw new Error("live figure document has no dataset binding");
  if (!dataset) throw new Error(`live figure document requires dataset "${document.bindings.datasetId}"`);
  if (dataset.id !== document.bindings.datasetId) {
    throw new Error(`figure document is bound to dataset "${document.bindings.datasetId}", not "${dataset.id}"`);
  }
  return { data: dataset.data, channelRoles: dataset.channelRoles };
}

/** Build the figure request for `ds` as it is currently displayed.
 *
 *  Throws when nothing is visible — callers surface that as an ordinary
 *  export/copy failure rather than posting an empty figure. */
export function buildFigureSpec(
  s: StoreGet,
  ds: Dataset,
  stem: string,
  o: FigureRenderOpts,
  extras: { autoSeriesStyles?: boolean } = {},
): FigureSpec {
  const raw = s();
  // R7: `raw` is the live singleton, which a refocus-mid-export race can
  // desync from `ds` -- neutralize facetKey rather than resolve it against
  // the wrong dataset's channels.
  const st = raw.activeId === ds.id ? raw : { ...raw, facetKey: null };
  return buildFigureSpecForView(st, ds.data, ds.channelRoles, ds.errorRoles, stem, o, {
    liveDataset: ds,
    autoSeriesStyles: extras.autoSeriesStyles,
  });
}

/** Build the common export transport from a complete PlotView projection. The
 * legacy StoreGet entry point and the FigureDocument entry point both route
 * here, so export parity does not depend on duplicated field-by-field maps. */
function buildFigureSpecForView(
  st: PlotView,
  data: DataStruct,
  channelRoles: Dataset["channelRoles"] | undefined,
  errors: readonly ErrorBinding[] | undefined,
  stem: string,
  o: FigureRenderOpts,
  extras: {
    groupKey?: number | null;
    xBreaks?: readonly [number, number][];
    transparent?: boolean;
    filename?: string | null;
    publicationOverrides?: FigureOverrides | null;
    /** `undefined` derives from the canonical PlotView; `null` omits styles. */
    publicationSeriesStyles?: FigureSpec["series_styles"] | null;
    /** Preserve the valid canonical case where an explicitly selected channel
     * is deliberately used for both X and Y. */
    allowExplicitXAsY?: boolean;
    /** C2/flat-path fix: bound live `Dataset` (absent for frozen), used to
     * prune BOTH facets (via `resolveFacetsOrThrow`) and a flat export's own
     * `dataset`/`error_spans` (via `wireDataset` above) to its analysisData
     * view -- excluded rows and rows the Data Filter drops. */
    liveDataset?: Dataset | null;
    /** P3.3: opt IN to the auto dash/marker cycle for THIS request. Passed only
     *  by a producer whose LIVE canvas is on screen cycling the same series at
     *  the same positions — the focused window's Stage export and the Figure
     *  Builder's window-target preview/Export. Absent everywhere else on
     *  purpose — see `seriesCycle` below. */
    autoSeriesStyles?: boolean;
  } = {},
): FigureSpec {
  // #54 Stage 3: honor the window's page — figsize (inches) + margins. Absent pageSetup keeps the preset size + tight_layout behaviour.
  const ps = st.pageSetup;
  const pageSize = ps ? pageSizeInches(ps) : null;
  const overrides = ps
    ? (compactOverrides({
        ...(viewOverrides(st) ?? {}),
        margins: marginFractions(ps),
      }) ?? undefined)
    : viewOverrides(st);
  const withBreaks = extras.xBreaks?.length
    ? (compactOverrides({ ...overrides, x_breaks: extras.xBreaks.map((range) => [...range] as [number, number]) }) ?? undefined)
    : overrides;

  // Match the DISPLAY order, not the raw yKeys: seriesOrder and hidden legend
  // entries are both visible-state decisions. Multi-X Origin books also
  // require the live xKey instead of silently falling back to time.
  // The UNFILTERED display list is kept: it is the canvas' own index space
  // (`usePlotPayload` leaves a hidden series in `payload.series` with
  // `show:false`), and P3.3's dash/marker cycle plus the series palette are
  // both resolved against it below so the export cannot land a channel on a
  // different display position than the screen did.
  const displayChannels = effectiveChannels(
    data,
    st.yKeys,
    extras.allowExplicitXAsY && st.yKeys !== null ? null : st.xKey,
    channelRoles,
    st.seriesOrder,
  );
  const plotted = displayChannels.filter((ch) => !st.hiddenChannels.includes(ch));

  // Legend renames / decoded Origin captions are channel-keyed. Apply them to a
  // request-local DataStruct label copy so the backend series builder and legend
  // path both see the same display names without mutating the imported workbook.
  const dataset = Object.keys(st.seriesLabels).length
    ? {
        ...data,
        labels: data.labels.map((label, ch) => st.seriesLabels[ch] ?? label),
      }
    : data;

  // F4.4: a durable facet binding renders the SAME grid Stage shows on
  // screen (built from st.xKey/yKeys, not plotted -- see resolveFacetsOrThrow's doc, C5/R4).
  const facets = resolveFacetsOrThrow(dataset, st.facetKey, st.xKey, st.yKeys, extras.liveDataset, plotted.length);

  // The flat-path counterpart to C2's facet fix (FIGURE_AUTHORING_WORKFLOW_PLAN,
  // "a pre-existing gap noted while fixing C2"): a FLAT export's wire `dataset`
  // used to be built straight off the raw, row-unpruned `data`, so an excluded
  // row or one the Data Filter drops could still reach a PNG/SVG/PDF/clipboard
  // export the on-screen plot never showed. `facets === undefined` is the
  // "genuinely flat" gate -- a faceted request's `dataset` field is already
  // documented (C7) as unused server-side beyond C4's column-level label
  // derivation, so it is left exactly as `resolveFacetsOrThrow` above computed
  // it (raw), matching the closed facet item byte-for-byte rather than
  // silently re-scoping it. `pruneToLiveDataset` is a no-op (`=== data`
  // fast-path) for a frozen/document-only call (`extras.liveDataset` absent),
  // so that case is byte-identical to before this fix.
  const wireDataset = facets === undefined ? pruneToLiveDataset(dataset, extras.liveDataset) : dataset;

  // P3.3 auto dash/marker cycle (`lib/seriesStyleCycle.ts`). OPT-IN, in two
  // senses: `extras.autoSeriesStyles` is passed by the LIVE stage export
  // (`buildStageFigureSpec`) and by nothing else — a saved document, a Figure
  // Page panel, a Figure Builder preview and a graph template all render
  // uncycled, which is what keeps a persisted `publication.seriesStyles` array
  // the user's RAW styles and makes a document authored with the preference on
  // reopen identically with it off. And `overlayExportsSeriesStyles` refuses the
  // views this route cannot style series-by-series anyway (`group_col` and
  // `facets` are documented as ignoring `series_styles` in
  // `routes/export_figures.py`; `stackMode` is the screen-only panel split that
  // this single-figure request does not reproduce) — the SAME predicate
  // `PlotStage.tsx` gates its canvas on, so the two cannot disagree about which
  // views cycle. Positions come from the UNFILTERED display list so a hidden
  // series does not shift every later channel's dash (and colour) by one.
  // (No separate `facets === undefined` clause: `facets` is non-undefined only
  // when `st.facetKey` is set, which the predicate below already refuses. A
  // clause no sabotage can make fail is dead code, not defence in depth.)
  //
  // ONE more refusal rides the SAME predicate, and it is about the display list
  // rather than the view: `seriesStyleCycle.displayListsAgree` (folded into
  // `overlayExportsSeriesStyles`) refuses an X channel that is also in `yKeys`,
  // because `allowExplicitXAsY` keeps it in `displayChannels` AS a Y series
  // while the canvas' own call (`usePlotPayload.fetchChannels`) always drops it.
  // It lived HERE as a local `xAlsoPlotted` test, which is why it was a
  // divergence rather than a refusal: the canvases could not see it, so with
  // `xKey:1, yKeys:[1,2,3]` the screen drew channels 2 and 3 solid/dashed and
  // the PDF drew all three solid.
  const seriesCycle =
    extras.autoSeriesStyles &&
    overlayExportsSeriesStyles({
      // `extras.groupKey` is what actually rides the wire; `st.groupKey` is the
      // view's own binding, which the plain live entry point does NOT forward —
      // a grouped view exported through it already renders an ungrouped overlay
      // while the screen shows one series per level, so either being set is
      // enough to refuse.
      groupKey: extras.groupKey ?? st.groupKey,
      facetKey: st.facetKey,
      stackMode: st.stackMode,
      polarMode: st.polarMode,
      statMode: st.statMode,
      xKey: st.xKey,
      yKeys: st.yKeys,
    })
      ? plotted.map((ch) => displayChannels.indexOf(ch))
      : null;

  // Secondary (right) Y axis (matplotlib twinx): y2Keys tags a SUBSET of
  // `plotted` — send y_keys = the FULL plotted list (the backend's y2_keys is a
  // subset marker, not a replacement), plus that subset in display order, so
  // the render shows the same dual-Y split the screen does. The split + the
  // scale/format inherit rules live in lib/axisspec.ts (#54 pass B).
  const y2Axis = resolveSecondaryAxis(plotted, secondaryAxisFromView(st), {
    scale: st.yScale,
    fmt: st.yFmt,
  });
  // The renderer deliberately has no grouped-secondary-axis semantic: group
  // expansion produces synthetic primary-axis series, so the backend rejects
  // this combination. Fail before transport rather than silently dropping a
  // canonical binding or sending a request guaranteed to receive a 422.
  if (extras.groupKey !== null && extras.groupKey !== undefined && y2Axis !== null) {
    throw new Error("grouped figures cannot use a secondary Y axis");
  }
  // `overrides` was built before this function learned the plotted/y2 split —
  // gate the two fields that depend on it (a stale y2_lim; a log-scaled
  // secondary axis's minor ticks) now that the split is known.
  const publicationOverrides = mergeFigureOverrides(withBreaks, extras.publicationOverrides);
  const gatedOverrides = gateY2Overrides(publicationOverrides, {
    y2Plotted: y2Axis !== null,
    minorTicks: st.xScale === "log" || st.yScale === "log" || secondaryAxisIsLog(y2Axis),
  });

  return {
    dataset: wireDataset,
    x_key: st.xKey ?? undefined,
    y_keys: plotted,
    x_scale: st.xScale,
    y_scale: st.yScale,
    x_fmt: axisFmtParam(st.xFmt),
    y_fmt: axisFmtParam(st.yFmt),
    x_step: st.xStep,
    y_step: st.yStep,
    // y2Fmt/y2Scale null inherit yFmt/yScale on screen — `resolveSecondaryAxis`
    // applied that same inherit-default above, so the render matches the live
    // plot without this call site restating the rule.
    ...secondaryAxisWire(y2Axis),
    ...(extras.groupKey === null || extras.groupKey === undefined ? {} : { group_col: extras.groupKey }),
    ...(facets === undefined ? {} : { facets }),
    fmt: o.fmt,
    style: o.style,
    dpi: o.dpi,
    width_in: pageSize?.width_in,
    height_in: pageSize?.height_in,
    title: o.title,
    x_label: o.xLabel || undefined,
    y_label: o.yLabel || undefined,
    ...(extras.publicationSeriesStyles === undefined
      ? { series_styles: buildExportStyles(plotted, st.seriesStyles, seriesCycle) }
      : extras.publicationSeriesStyles === null
        ? {}
        : { series_styles: structuredClone(extras.publicationSeriesStyles) }),
    // MAIN #36: the SAME spans the canvas draws, so a PDF cannot quietly
    // understate the uncertainty the screen showed. Built from `wireDataset`,
    // not the raw `data`, so a pruned row's magnitude can never outnumber
    // (and misalign with) the pruned `dataset`/`y_keys` rows above.
    ...(errors?.length
      ? { error_spans: exportErrorSpans(wireDataset, plotted, errors) }
      : {}),
    overrides: gatedOverrides,
    ...(extras.transparent === undefined ? {} : { transparent: extras.transparent }),
    filename: extras.filename ?? stem,
  };
}

/** Derive an export request directly from the canonical document. Frozen
 * documents render their immutable data snapshot; live documents reject a
 * missing or mismatched dataset instead of exporting an accidental sibling.
 * FigureSpec has no transport fields for `mark` or Y/Y2 breaks; those remain
 * intact in the FigureDocument and are never flattened/deleted by this
 * adapter. X breaks do have a renderer field and are emitted. F4.4 (export
 * half, closed): `facetKey` now rides the wire too, as a resolved `facets`
 * panel list built by `buildFigureSpecForView`'s `buildFacetSpecs` call —
 * see that function's own doc. */
export function buildFigureSpecFromDocument(
  document: FigureDocument,
  dataset: Dataset | null | undefined,
  stem: string,
  overrides: FigureDocumentRenderOpts = {},
): FigureSpec {
  const resolved = resolveFigureDocumentData(document, dataset);
  const view = figureDocumentToPlotView(document);
  // `null` is an explicit "use this export's stem" override; only omitted
  // (`undefined`) inherits the saved document filename.
  const filename = overrides.filename === undefined ? document.output.filename : overrides.filename;
  return buildFigureSpecForView(
    view,
    resolved.data,
    resolved.channelRoles,
    document.bindings.errors,
    stem,
    {
      fmt: overrides.fmt ?? document.output.format,
      style: overrides.style ?? document.output.stylePreset,
      dpi: overrides.dpi ?? document.output.dpi,
      title: overrides.title ?? view.plotTitle,
      xLabel: overrides.xLabel ?? view.xAxisLabel,
      yLabel: overrides.yLabel ?? view.yAxisLabel,
    },
    {
      groupKey: document.bindings.groupKey,
      xBreaks: document.plot.axisBreaks.x,
      transparent: overrides.transparent ?? document.output.transparent,
      filename,
      publicationOverrides: document.publication?.overrides,
      publicationSeriesStyles: document.publication?.seriesStyles,
      allowExplicitXAsY: true,
      autoSeriesStyles: overrides.autoSeriesStyles,
      liveDataset: document.data.mode === "frozen" ? null : (dataset ?? null), // C2
    },
  );
}

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
 *   - no focused window, the focused window isn't `kind:"plot"`, or it has
 *     no document yet — none of these should occur in practice (every real
 *     window has carried a document since F1, and only a `kind:"plot"`
 *     window can hold focus) but the fallback is the safe response to an
 *     invariant violation, not a crash;
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
      })
    : buildFigureSpec(s, ds, stem, o, { autoSeriesStyles });
  return extra.transparent === undefined ? spec : { ...spec, transparent: extra.transparent };
}

/** Project the canvas error spans onto the export wire shape.
 *
 *  `buildErrorSpans` keys by uPlot COLUMN (0 = x, p+1 = the p-th series); the
 *  renderer wants one entry per plotted SERIES, so this re-indexes rather than
 *  letting the two conventions meet in the route — where the off-by-one would
 *  show up as error bars on the wrong curve. */
export function exportErrorSpans(
  data: DataStruct,
  plotted: number[],
  roles: readonly ErrorBinding[],
): ({ x?: ErrorPair; y?: ErrorPair } | null)[] {
  const byCol = buildErrorSpans(data, plotted, roles);
  return plotted.map((_ch, p) => {
    const spans = byCol.get(p + 1);
    if (!spans?.length) return null;
    const out: { x?: ErrorPair; y?: ErrorPair } = {};
    for (const s of spans) out[s.axis] = { plus: s.plus, minus: s.minus };
    return out;
  });
}
