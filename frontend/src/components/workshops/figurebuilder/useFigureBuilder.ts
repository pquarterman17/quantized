// Figure builder state hook. Holds the publication-figure parameters, builds the
// shared request spec from the active dataset + on-screen plot state, drives a
// debounced server-rendered PNG preview, and exports at the chosen format/DPI.
// The heavy rendering is the matplotlib export route — this is a thin WYSIWYG
// layer on top of it (the export backend already existed; this adds the preview).

import { useEffect, useMemo, useState } from "react";

import type { FigureSpec } from "../../../lib/api";
import { appendErrorBinding, patchErrorBindingList, removeErrorBindingFromList } from "./canonicalErrors";
import { toggleChannelPlotted, toggleChannelSecondary, type ChannelMembership } from "./canonicalChannels";
import { effectiveFigureOverrides, effectiveXBreaks, migrateXBreaksPatch, publicationOverridesDelta } from "./canonicalOverrides";
import { computeCanonicalReadiness, type CanonicalReadiness } from "./canonicalReadiness";
import { appendRefLine, patchRefLineList, removeRefLineFromList } from "./canonicalRefLines";
import { regionShadeBindings } from "./canonicalRegionShades";
import { deriveShapeRows, patchShapeList, removeShapeFromList } from "./canonicalShapes";
import { selectSessionLiveDrifted } from "./canonicalSession";
import { FIGURE_STYLE_DPI } from "./figureOutputConstants";
import { buildLegacyFigureDoc, buildLegacyFigureSpec, type LegacyFigureState } from "./legacyFigure";
import { dragPreviewElement } from "./previewDrag";
import { exportPreviewFigure } from "./previewExport";
import { editPreviewElementText, previewElementText, selectPreviewElement } from "./previewSelect";
import { useGraphTemplates } from "./useGraphTemplates";
import { usePreviewRender } from "./usePreviewRender";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import { figureDocumentToPlotView, type FigureViewState } from "../../../lib/figureDocument";
import type { ExportSeriesStyle } from "../../../lib/exportStyles";
import { inferErrorBindings, type ErrorBinding, type ErrorSide } from "../../../lib/errorRoles";
import { defaultDenseChannels, effectiveChannels } from "../../../lib/plotdata";
import { xAxisIsDate } from "../../../lib/tickFormat";
import type { AxisFormat, AxisScale, DataStruct, RefLine, Shape, SeriesStyle } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

let _docSeq = 0;

// Output format/style/DPI constants live in figureOutputConstants.ts (pure
// data, extracted to fund F2.4e's shape-drag addition) — re-exported here so
// every existing importer of this module is untouched.
export { FIGURE_FORMATS, FIGURE_STYLES, FIGURE_STYLE_DPI } from "./figureOutputConstants";

export function useFigureBuilder() {
  const active = useActiveDataset();
  const yKeys = useApp((s) => s.yKeys);
  const xKey = useApp((s) => s.xKey);
  const y2Keys = useApp((s) => s.y2Keys); // item 2: legacy secondary-axis presence
  const xScale = useApp((s) => s.xScale);
  const yScale = useApp((s) => s.yScale);
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const setStatus = useApp((s) => s.setStatus);
  const figureDocSeed = useApp((s) => s.figureDocSeed);
  const clearFigureDocSeed = useApp((s) => s.clearFigureDocSeed);
  const addFigureDoc = useApp((s) => s.addFigureDoc);
  const datasets = useApp((s) => s.datasets);
  const plotWindows = useApp((s) => s.plotWindows);
  const focusedWindowId = useApp((s) => s.focusedWindowId);
  const publicationSession = useApp((s) => s.figurePublicationSession);
  const patchFigurePublicationDraft = useApp((s) => s.patchFigurePublicationDraft);
  const applyFigurePublicationEdit = useApp((s) => s.applyFigurePublicationEdit);
  const cancelFigurePublicationEdit = useApp((s) => s.cancelFigurePublicationEdit);

  const [fmt, setFmt] = useState("pdf");
  const [style, setStyleRaw] = useState("default");
  const [dpi, setDpi] = useState(FIGURE_STYLE_DPI.default);
  const [title, setTitle] = useState("");
  const [xLabel, setXLabel] = useState("");
  const [yLabel, setYLabel] = useState("");
  // Property-panel overrides (#11): one config object, folded into the spec.
  const [overrides, setOverrides] = useState<FigureOverrides>({});
  // Channel picks: default = mirror the on-screen plot; a re-opened FigureDoc
  // (#12) restores its own picks without touching the live plot state.
  const [docXKey, setDocXKey] = useState<number | null | undefined>(undefined);
  const [docYKeys, setDocYKeys] = useState<number[] | null | undefined>(undefined);
  // Grouped doc (#12 Slice 5): only ever set by opening a FigureDoc whose
  // config carries one (the Graph Builder handoff) -- the plain builder,
  // mirroring the live on-screen plot, has no "group" concept of its own,
  // so a fresh (non-doc-seeded) builder always sends group_col: undefined.
  const [docGroupCol, setDocGroupCol] = useState<number | null>(null);
  const [docScales, setDocScales] = useState<{ x: AxisScale; y: AxisScale } | undefined>(undefined);
  // FigureDoc styles are aligned to its saved Y display order. `undefined`
  // means a fresh builder should continue mirroring live per-channel styles;
  // null is an explicitly style-free saved document.
  const [docSeriesStyles, setDocSeriesStyles] = useState<
    (ExportSeriesStyle | null)[] | null | undefined
  >(undefined);
  // Frozen doc (#12): render from its data snapshot instead of the live dataset.
  const [frozenData, setFrozenData] = useState<DataStruct | null>(null);

  // Restore an opened FigureDoc's full config into the builder (one-shot).
  useEffect(() => {
    if (!figureDocSeed) return;
    const c = figureDocSeed.config;
    setFmt(c.fmt);
    setStyleRaw(c.style);
    setDpi(c.dpi); // doc carries its own saved dpi — restore verbatim, not the preset default
    setTitle(c.title);
    setXLabel(c.xLabel);
    setYLabel(c.yLabel);
    setOverrides(c.overrides ?? {});
    setDocXKey(c.xKey);
    setDocYKeys(c.yKeys);
    setDocGroupCol(c.groupCol ?? null); // absent on a pre-Slice-5 doc -> null
    setDocScales({ x: c.xScale, y: c.yScale });
    setDocSeriesStyles(c.seriesStyles);
    setFrozenData(!figureDocSeed.live ? (figureDocSeed.dataSnapshot ?? null) : null);
    clearFigureDocSeed();
  }, [figureDocSeed, clearFigureDocSeed]);
  // Which panel group a preview click focused (#13).
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  // Selection is a monotonic signal, not just the group name: re-selecting
  // the SAME element after the user manually collapsed its panel must still
  // reopen it, but a boolean/string `forceOpen` prop that stays unchanged
  // gives Group's effect nothing to react to. Bumping this on every
  // selection gives it one.
  const [focusNonce, setFocusNonce] = useState(0);

  // Style preset change: sync DPI to that preset's calibrated value (audit
  // follow-up — the field previously stayed wherever it was left, so a
  // journal preset's dpi never actually reached the export dialog). The user
  // can still freely override the DPI field afterwards; only a *style*
  // change re-syncs it.
  function setStyle(next: string): void {
    setStyleRaw(next);
    const presetDpi = FIGURE_STYLE_DPI[next];
    if (presetDpi !== undefined) setDpi(presetDpi);
  }

  const canonical = publicationSession !== null;
  const canonicalDocument = publicationSession?.draft ?? null;
  const canonicalView = canonicalDocument ? figureDocumentToPlotView(canonicalDocument) : null;
  const canonicalDataset = canonicalDocument?.bindings.datasetId
    ? datasets.find((dataset) => dataset.id === canonicalDocument.bindings.datasetId) ?? null
    : null;
  // F2.3c: readiness resolution itself lives in canonicalReadiness.ts (a
  // pure function of document + dataset) -- this hook just memoizes the call.
  const canonicalReadiness = useMemo<CanonicalReadiness | null>(
    () => computeCanonicalReadiness(canonicalDocument, canonicalDataset),
    [canonicalDocument, canonicalDataset],
  );
  const canonicalData = canonicalReadiness?.state === "missing-source"
    ? null
    : canonicalReadiness?.data ?? null;
  const patchCanonical = (patch: (document: NonNullable<typeof canonicalDocument>) => NonNullable<typeof canonicalDocument>) => {
    if (!canonical) return;
    patchFigurePublicationDraft((draft) => patch(draft));
  };
  const setCanonicalOutput = (patch: Partial<NonNullable<typeof canonicalDocument>["output"]>) =>
    patchCanonical((document) => ({ ...document, output: { ...document.output, ...patch } }));
  const setCanonicalView = (patch: Partial<FigureViewState>) =>
    patchCanonical((document) => ({ ...document, plot: { ...document.plot, view: { ...document.plot.view, ...patch } } }));
  // Reads/writes route through the SAME merge the renderer uses (view +
  // publication delta), as a minimal write-delta — see canonicalOverrides.ts's
  // module doc for why a bare `publication.overrides` read/write was a bug.
  const effective = canonical
    ? effectiveFigureOverrides(canonicalView!, canonicalDocument?.publication?.overrides)
    : null;
  const setCanonicalOverrides = (next: FigureOverrides) =>
    patchCanonical((document) => ({
      ...document,
      publication: {
        ...document.publication,
        overrides: publicationOverridesDelta(effective!, next, document.publication?.overrides),
      },
    }));
  const setCanonicalStyle = (next: string) =>
    setCanonicalOutput({ stylePreset: next, ...(FIGURE_STYLE_DPI[next] === undefined ? {} : { dpi: FIGURE_STYLE_DPI[next] }) });
  const activeOverrides = effective ?? overrides;
  const setActiveOverrides = canonical ? setCanonicalOverrides : setOverrides;
  // Item 2: does the panel's y2 min/max have a secondary axis to apply to --
  // gateY2Overrides drops y2_lim server-side otherwise (placebo fields).
  const hasY2 = canonical ? (canonicalDocument?.bindings.y2Keys?.length ?? 0) > 0 : (y2Keys?.length ?? 0) > 0;
  // Item 3: canonical x-breaks read/write through the unified home — see
  // canonicalOverrides.ts's effectiveXBreaks/migrateXBreaksPatch.
  const xBreaks = canonical ? effectiveXBreaks(canonicalDocument!) : undefined;
  const setXBreaks = canonical
    ? (next: [number, number][]) => patchCanonical((document) => migrateXBreaksPatch(document, next))
    : undefined;

  // F2.3b: per-series properties (color/width/mode, visibility, order) are
  // genuinely canonical PlotView fields (seriesStyles/hiddenChannels/
  // seriesOrder/seriesLabels) with no FigureOverrides equivalent -- unlike
  // legend/annotations/breaks above, they write straight through
  // setCanonicalView instead of the publication-overrides delta bridge, the
  // same way editElementText's title/xLabel/yLabel already do. Error-bar
  // DESIGNATIONS stay a read-only summary here -- editing them is the
  // separate Error columns group below (F2.3f).
  const seriesChannels = canonical && canonicalData && canonicalDocument
    ? effectiveChannels(
        canonicalData,
        canonicalDocument.bindings.yKeys,
        canonicalDocument.bindings.xKey,
        canonicalDataset?.channelRoles,
        canonicalView?.seriesOrder ?? null,
      )
    : [];
  const setSeriesStyle = (channel: number, patch: Partial<SeriesStyle>) =>
    setCanonicalView({
      seriesStyles: {
        ...canonicalView?.seriesStyles,
        [channel]: { ...canonicalView?.seriesStyles?.[channel], ...patch },
      },
    });
  const setSeriesHidden = (channel: number, hidden: boolean) => {
    const current = canonicalView?.hiddenChannels ?? [];
    setCanonicalView({
      hiddenChannels: hidden
        ? (current.includes(channel) ? current : [...current, channel])
        : current.filter((c) => c !== channel),
    });
  };
  const moveSeries = (channel: number, direction: -1 | 1) => {
    const order = [...seriesChannels];
    const index = order.indexOf(channel);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setCanonicalView({ seriesOrder: order });
  };

  // F2.3c: drawn shapes (`document.plot.view.shapes`) are the SAME kind of
  // canonical-only PlotView field as F2.3b's series properties above -- no
  // FigureOverrides equivalent, so edits write straight through
  // setCanonicalView. Adding a NEW shape stays a Stage gesture (drag-to-draw
  // needs a live canvas); this only reaches editing/removing what's already
  // on the draft. Canonical-only: empty in legacy mode, same as seriesChannels.
  const shapes: readonly Shape[] = canonical ? canonicalView?.shapes ?? [] : [];
  const shapeRows = deriveShapeRows(shapes);
  const setShapeStyle = (id: string, patch: Partial<Omit<Shape, "id">>) =>
    setCanonicalView({ shapes: patchShapeList(shapes, id, patch) });
  const removeShape = (id: string) =>
    setCanonicalView({ shapes: removeShapeFromList(shapes, id) });

  // F2.3d: reference lines are the same canonical-only PlotView field as
  // F2.3b's series properties and F2.3c's shapes -- no FigureOverrides
  // equivalent, so edits write straight through setCanonicalView. Unlike
  // shapes, ADD belongs here too (axis + number needs no live canvas). Axis
  // stays read-only per row; see RefLinePropertiesPanel's doc.
  const refLines: readonly RefLine[] = canonical ? canonicalView?.refLines ?? [] : [];
  const setRefLineValue = (id: string, value: number) =>
    setCanonicalView({ refLines: patchRefLineList(refLines, id, { value }) });
  const addRefLine = (axis: RefLine["axis"], value: number) =>
    setCanonicalView({ refLines: appendRefLine(refLines, axis, value) });
  const removeRefLine = (id: string) =>
    setCanonicalView({ refLines: removeRefLineFromList(refLines, id) });

  // F2.3j: region shades bundle from canonicalRegionShades.ts's
  // regionShadeBindings -- see that module's doc for why (this hook sits
  // close to its own size ceiling).
  const regionShadeOps = regionShadeBindings(canonical ? canonicalView?.regionShades ?? [] : [], setCanonicalView);

  // F2.3e: axis tick formats are the same canonical-only PlotView fields as
  // the three slices above -- and they already reach the renderer
  // (figureSpec's x_fmt/y_fmt + secondaryAxisWire's y2_fmt), so the panel was
  // the only missing piece. y2Fmt null = inherit Y, the Stage's own rule.
  const setXFmtCanonical = (next: AxisFormat) => setCanonicalView({ xFmt: next });
  const setYFmtCanonical = (next: AxisFormat) => setCanonicalView({ yFmt: next });
  const setY2FmtCanonical = (next: AxisFormat | null) => setCanonicalView({ y2Fmt: next });

  // F2.3f: error-column bindings live on `document.bindings.errors`, not
  // the PlotView, so edits patch the document directly instead of routing
  // through setCanonicalView. Index is a binding's whole identity (no `id`
  // field -- canonicalErrors.ts's doc explains why).
  const errorBindings: readonly ErrorBinding[] = canonicalDocument?.bindings.errors ?? [];
  const setErrorBindings = (next: ErrorBinding[]) =>
    patchCanonical((document) => ({ ...document, bindings: { ...document.bindings, errors: next } }));
  const patchErrorBinding = (index: number, patch: Partial<Omit<ErrorBinding, "channel">>) =>
    setErrorBindings(patchErrorBindingList(errorBindings, index, patch));
  const addErrorBinding = (channel: number, target: number, axis: ErrorBinding["axis"], side: ErrorSide) =>
    setErrorBindings(appendErrorBinding(errorBindings, channel, target, axis, side));
  const removeErrorBinding = (index: number) =>
    setErrorBindings(removeErrorBindingFromList(errorBindings, index));
  const detectErrorBindings = () => canonicalData && setErrorBindings(inferErrorBindings(canonicalData));

  // F2.3g: channel membership (X axis, each other channel's Y/Y2/not-plotted
  // state) lives on `document.bindings` too -- same "not the PlotView" shape
  // as F2.3f's error bindings. Guards mirror ChannelsCard's `toggle`/
  // `toggleAxis` (canonicalChannels.ts); a rejected toggle returns the SAME
  // object, so the wrapper below skips the patch (and its history entry).
  const channelBindings: ChannelMembership = {
    xKey: canonicalDocument?.bindings.xKey ?? null, yKeys: canonicalDocument?.bindings.yKeys ?? null, y2Keys: canonicalDocument?.bindings.y2Keys ?? null,
  };
  const channelFallback = canonicalData ? defaultDenseChannels(canonicalData, channelBindings.xKey) : [];
  const setChannelBindings = (patch: Partial<ChannelMembership>) =>
    patchCanonical((document) => ({ ...document, bindings: { ...document.bindings, ...patch } }));
  const setChannelXKey = (xKey: number | null) => setChannelBindings({ xKey });
  const toggleChannelY = (channel: number) => {
    const next = toggleChannelPlotted(channelBindings, channel, channelFallback);
    if (next !== channelBindings) setChannelBindings(next);
  };
  const toggleChannelY2 = (channel: number) => {
    const next = toggleChannelSecondary(channelBindings, channel, channelFallback);
    if (next !== channelBindings) setChannelBindings(next);
  };

  // F2.3h: same `document.bindings` shape as F2.3f's error bindings above
  // (not the PlotView) -- patches the document directly. Already reaches
  // the renderer (`group_col`); the panel was the only missing piece.
  // Facet editing is deliberately NOT exposed -- `bindings.facetKey` has no
  // render-request wire and no creation surface anywhere in the app; see
  // GroupingPanel.tsx's doc for the full reasoning (the F2.3d precedent).
  const groupKey = canonicalDocument?.bindings.groupKey ?? null;
  const setGroupKey = (next: number | null) =>
    patchCanonical((document) => ({ ...document, bindings: { ...document.bindings, groupKey: next } }));

  // The request spec shared by the preview (PNG) and the export (chosen format) —
  // mirrors the on-screen plot: channel selection, log scales, per-series styles.
  const data = canonical ? canonicalData : (frozenData ?? active?.data ?? null);
  const effXKey = docXKey !== undefined ? docXKey : (xKey ?? null);
  const effYKeys = docYKeys !== undefined ? docYKeys : yKeys;
  const effXScale = docScales?.x ?? xScale;
  const effYScale = docScales?.y ?? yScale;
  // The whole legacy field set as ONE object, so the preview request and the
  // "Save as figure" doc are built from the same picks by construction — see
  // legacyFigure.ts's module doc.
  const legacyState = useMemo<LegacyFigureState>(() => ({
    data, xKey: effXKey, yKeys: effYKeys, xScale: effXScale, yScale: effYScale,
    xFmt, yFmt, style, overrides, title, xLabel, yLabel,
    seriesStyles, docSeriesStyles, docGroupCol,
  }), [
    data, effXKey, effYKeys, effXScale, effYScale, xFmt, yFmt, style,
    overrides, title, xLabel, yLabel, seriesStyles, docSeriesStyles, docGroupCol,
  ]);
  const legacySpec = useMemo<FigureSpec | null>(() => buildLegacyFigureSpec(legacyState), [legacyState]);
  const canonicalSpec = canonicalReadiness?.state === "ready"
    ? canonicalReadiness.spec
    : null;
  const spec = canonical ? canonicalSpec : legacySpec;
  // Debounced PNG preview + hit-map — see usePreviewRender's module doc.
  const { preview, hitmap, error, busy } = usePreviewRender(spec, canonical);
  // A window-target session outlives its target window closing/unfocusing
  // (windows.ts's closeWindow clears the common case, but a session can still
  // be left pointing at a background window — applyFigurePublicationEdit's
  // window bridge requires the EXACT focused window, so Apply would otherwise
  // silently no-op forever). `target === "new-editable"` short-circuits this
  // to false — that path has no window to lose.
  const targetBlocked = publicationSession?.target === "window" && (
    !plotWindows.some((w) => w.id === publicationSession.windowId) ||
    focusedWindowId !== publicationSession.windowId
  );
  // Item 1: catch a Stage edit made behind the open, non-modal dialog on THIS
  // render rather than only via a rejected Apply (staleBaseline, above). MUST
  // stay a real subscription, never a `useApp.getState()` read — the live
  // document derives from view SINGLETONS this hook selects on none of; see
  // canonicalSession.ts's selectSessionLiveDrifted for what that let through.
  const liveDrifted = useApp(selectSessionLiveDrifted);
  const canApply = !targetBlocked && !publicationSession?.staleBaseline && !liveDrifted && canonicalReadiness?.state === "ready" && (
    publicationSession?.target === "new-editable" || (
      publicationSession !== null && JSON.stringify(publicationSession.baseline) !== JSON.stringify(publicationSession.draft)
    )
  );
  const applyBlockedReason = targetBlocked
    ? "focus the previewed plot window to apply"
    : publicationSession?.staleBaseline || liveDrifted
    ? "the plot changed while previewing — Cancel and reopen Publication Preview to pick up the changes"
    : null;

  // Save the current configuration as a named FigureDoc (#12). Live docs
  // reference the dataset by id; frozen docs carry the data snapshot.
  function saveAsFigure(name: string, live: boolean): void {
    const doc = buildLegacyFigureDoc(
      legacyState,
      { id: `figd-${Date.now().toString(36)}-${++_docSeq}`, name, datasetId: active?.id ?? null, live },
      { fmt, dpi },
    );
    if (doc) addFigureDoc(doc);
  }

  // User graph templates (#15) — legacy-mode-only by nature; see the module doc.
  const templates = useGraphTemplates({ legacy: legacyState, setStyle, setOverrides, setDocSeriesStyles, setStatus });

  // ── Preview interactions (#13/#14) ────────────────────────────────────
  // Dispatch lives in previewSelect.ts (moved out to fund F2.3h's grouping
  // panel, same "extract first" move previewDrag.ts made for dragElement);
  // these are thin wrappers binding the hook's live state.
  const previewSelectDeps = {
    setFocusGroup, setFocusNonce, canonical, canonicalView, setCanonicalView,
    title, setTitle, xLabel, setXLabel, yLabel, setYLabel,
  };
  const selectElement = (id: string): void => selectPreviewElement(previewSelectDeps, id);
  const editElementText = (id: string, value: string): void =>
    editPreviewElementText(previewSelectDeps, id, value);
  const textOf = (id: string): string => previewElementText(previewSelectDeps, id);

  /** Drag-to-place commit map — the dispatch lives in previewDrag.ts (moved
   *  whole when the F2.4e+F2.3f merge hit this module's size pin); this
   *  wrapper only binds the hook's live state. */
  const dragElement = (id: string, px: number, py: number, startPx?: number, startPy?: number): void =>
    dragPreviewElement(
      { hitmap, activeOverrides, setActiveOverrides, refLines, setRefLineValue, shapes, setShapeStyle },
      id, px, py, startPx, startPy,
    );

  /** Export commit — the dispatch lives in previewExport.ts (moved whole
   *  when F2.3g's channel wiring hit this module's size pin, the same move
   *  dragElement's previewDrag.ts made); this wrapper only binds the hook's
   *  live state. */
  const exportNow = (): Promise<void> =>
    exportPreviewFigure({
      canonicalDocument, canonicalReadiness, canonicalDataset, spec, frozenData, active, fmt, dpi, setStatus,
    });

  return {
    active,
    fmt: canonicalDocument?.output.format ?? fmt,
    setFmt: canonical ? (next: string) => setCanonicalOutput({ format: next }) : setFmt,
    style: canonicalDocument?.output.stylePreset ?? style,
    setStyle: canonical ? setCanonicalStyle : setStyle,
    dpi: canonicalDocument?.output.dpi ?? dpi,
    setDpi: canonical ? (next: number) => setCanonicalOutput({ dpi: next }) : setDpi,
    title: canonicalView?.plotTitle ?? title,
    setTitle: canonical ? (next: string) => setCanonicalView({ plotTitle: next }) : setTitle,
    xLabel: canonicalView?.xAxisLabel ?? xLabel,
    setXLabel: canonical ? (next: string) => setCanonicalView({ xAxisLabel: next }) : setXLabel,
    yLabel: canonicalView?.yAxisLabel ?? yLabel,
    setYLabel: canonical ? (next: string) => setCanonicalView({ yAxisLabel: next }) : setYLabel,
    preview,
    error: canonicalReadiness?.state === "ready" || !canonicalReadiness
      ? error
      : canonicalReadiness.error,
    canonicalReadiness: canonicalReadiness?.state ?? null,
    canExport: !canonical || canonicalReadiness?.state === "ready",
    busy,
    exportNow,
    overrides: activeOverrides,
    setOverrides: setActiveOverrides,
    hasY2,
    xBreaks,
    setXBreaks,
    // F2.3b: canonical-only (empty/no-op in legacy mode — see the field doc above).
    seriesChannels,
    seriesStyles: canonicalView?.seriesStyles ?? {},
    hiddenChannels: canonicalView?.hiddenChannels ?? [],
    seriesLabels: canonicalView?.seriesLabels ?? {},
    seriesErrors: canonicalDocument?.bindings.errors ?? [],
    setSeriesStyle,
    setSeriesHidden,
    moveSeries,
    // F2.3c: canonical-only (empty in legacy mode — see the field doc above).
    shapes,
    shapeRows,
    setShapeStyle,
    removeShape,
    // F2.3d: canonical-only (empty/no-op in legacy mode — see the field doc above).
    refLines,
    setRefLineValue,
    addRefLine,
    removeRefLine,
    // F2.3j: canonical-only (empty/no-op in legacy mode).
    ...regionShadeOps,
    // F2.3e: canonical-only. The fmt values fall back to the live singletons in
    // legacy mode so the panel can render there too, read-only-ish (the legacy
    // request already sends the live xFmt/yFmt — see legacyFigure.ts).
    canonicalXFmt: canonicalView?.xFmt ?? xFmt,
    canonicalYFmt: canonicalView?.yFmt ?? yFmt,
    canonicalY2Fmt: canonicalView?.y2Fmt ?? null,
    xIsDate: xAxisIsDate(data?.metadata, (canonicalView?.xFmt ?? xFmt).mode),
    setXFmtCanonical,
    setYFmtCanonical,
    setY2FmtCanonical,
    // F2.3f: canonical-only (empty/no-op in legacy mode — see the field doc above).
    errorBindings,
    patchErrorBinding,
    addErrorBinding,
    removeErrorBinding,
    detectErrorBindings,
    // F2.3g: canonical-only channel membership (empty/no-op in legacy mode).
    channelXKey: channelBindings.xKey,
    channelYKeys: channelBindings.yKeys,
    channelY2Keys: channelBindings.y2Keys,
    channelFallbackYKeys: channelFallback,
    channelRoles: canonicalDataset?.channelRoles,
    setChannelXKey,
    toggleChannelY,
    toggleChannelY2,
    // F2.3h: canonical-only (null/no-op in legacy mode — see setGroupKey's doc above).
    groupKey,
    setGroupKey,
    data,
    hitmap,
    focusGroup,
    focusNonce,
    selectElement,
    editElementText,
    textOf,
    dragElement,
    frozen: canonicalDocument?.data.mode === "frozen" || frozenData !== null,
    canonical,
    documentName: canonicalDocument?.name ?? null,
    publicationTarget: publicationSession?.target ?? null,
    dirty: publicationSession !== null && JSON.stringify(publicationSession.baseline) !== JSON.stringify(publicationSession.draft),
    canApply,
    applyBlockedReason,
    apply: applyFigurePublicationEdit,
    cancel: cancelFigurePublicationEdit,
    saveAsFigure,
    ...templates,
  };
}
