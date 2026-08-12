// Figure builder state hook. Holds the publication-figure parameters, builds the
// shared request spec from the active dataset + on-screen plot state, drives a
// debounced server-rendered PNG preview, and exports at the chosen format/DPI.
// The heavy rendering is the matplotlib export route — this is a thin WYSIWYG
// layer on top of it (the export backend already existed; this adds the preview).

import { useEffect, useMemo, useState } from "react";

import { exportFigure, renderFigureHitmap, type FigureSpec } from "../../../lib/api";
import { effectiveFigureOverrides, effectiveXBreaks, migrateXBreaksPatch, publicationOverridesDelta } from "./canonicalOverrides";
import { computeCanonicalReadiness, type CanonicalReadiness } from "./canonicalReadiness";
import { appendRefLine, patchRefLineList, removeRefLineFromList } from "./canonicalRefLines";
import { deriveShapeRows, patchShapeList, removeShapeFromList } from "./canonicalShapes";
import { selectSessionLiveDrifted } from "./canonicalSession";
import { buildLegacyFigureDoc, buildLegacyFigureSpec, type LegacyFigureState } from "./legacyFigure";
import { useGraphTemplates } from "./useGraphTemplates";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import { buildFigureSpecFromDocument } from "../../../lib/figureSpec";
import { figureDocumentToPlotView, type FigureViewState } from "../../../lib/figureDocument";
import type { ExportSeriesStyle } from "../../../lib/exportStyles";
import { effectiveChannels } from "../../../lib/plotdata";
import {
  groupForElement,
  pxToData,
  pxToFigureFraction,
  type FigureHitmap,
} from "../../../lib/previewmap";
import { xAxisIsDate } from "../../../lib/tickFormat";
import type { AxisFormat, AxisScale, DataStruct, RefLine, Shape, SeriesStyle } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

let _docSeq = 0;

export const FIGURE_FORMATS = ["pdf", "svg", "png", "tiff"];
export const FIGURE_STYLES = [
  "default",
  "aps",
  "nature",
  "thesis",
  "report",
  "web",
  "presentation",
  "poster",
];
// Calibrated raster DPI per preset, mirrored from
// src/quantized/calc/figure_styles.py's FIGURE_STYLES table (no styles-list
// endpoint exists to fetch this live — keep in sync by hand if the backend
// table changes; tests/test_calc_figure_styles.py guards the source values).
export const FIGURE_STYLE_DPI: Record<string, number> = {
  default: 200,
  aps: 600,
  nature: 600,
  thesis: 300,
  report: 300,
  web: 150,
  presentation: 150,
  poster: 150,
};

const PREVIEW_DPI = 110; // screen-resolution preview; export uses the chosen DPI

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
  const [preview, setPreview] = useState<string | null>(null);
  // The preview's element hit-map (#13) + which panel group a click focused.
  const [hitmap, setHitmap] = useState<FigureHitmap | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  // Selection is a monotonic signal, not just the group name: re-selecting
  // the SAME element after the user manually collapsed its panel must still
  // reopen it, but a boolean/string `forceOpen` prop that stays unchanged
  // gives Group's effect nothing to react to. Bumping this on every
  // selection gives it one.
  const [focusNonce, setFocusNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  // DESIGNATIONS (document.bindings.errors) are canonical too but stay
  // display-only here -- reassigning them needs the same channel-picker
  // "well" Graph Builder already owns (useGraphBuilder.ts), not a per-row
  // toggle; see canonicalSeries.ts's doc and the F2.3b decision log.
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

  // F2.3e: axis tick formats are the same canonical-only PlotView fields as
  // the three slices above -- and they already reach the renderer
  // (figureSpec's x_fmt/y_fmt + secondaryAxisWire's y2_fmt), so the panel was
  // the only missing piece. y2Fmt null = inherit Y, the Stage's own rule.
  const setXFmtCanonical = (next: AxisFormat) => setCanonicalView({ xFmt: next });
  const setYFmtCanonical = (next: AxisFormat) => setCanonicalView({ yFmt: next });
  const setY2FmtCanonical = (next: AxisFormat | null) => setCanonicalView({ y2Fmt: next });

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

  // Debounced PNG preview — re-renders on any spec change.
  useEffect(() => {
    if (!spec) {
      setPreview(null);
      if (canonical) {
        setHitmap(null);
        setBusy(false);
      }
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      renderFigureHitmap({ ...spec, dpi: PREVIEW_DPI })
        .then((m) => {
          if (cancelled) return;
          setHitmap(m);
          setPreview(`data:image/png;base64,${m.image}`);
          setError(null);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "preview failed");
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canonical, spec]);

  // ── Preview interactions (#13/#14) ────────────────────────────────────
  /** Click: focus the matching #11 panel group. Always bumps the nonce so a
   *  re-selection of the same group's element reopens a manually-collapsed
   *  panel instead of being a no-op. F2.3b: a rendered "series:N" hitbox now
   *  has somewhere to go too -- `groupForElement` deliberately stays null for
   *  it (per-series styles have no single N->channel mapping without the
   *  hitmap's plotted-position order), so it is special-cased straight to
   *  the new Series group here instead. */
  function selectElement(id: string): void {
    setFocusGroup(id.startsWith("series:") ? "Series" : groupForElement(id));
    setFocusNonce((n) => n + 1);
  }

  /** Double-click inline edit commits straight into the config fields. */
  function editElementText(id: string, value: string): void {
    if (id === "title") {
      if (canonical) setCanonicalView({ plotTitle: value });
      else setTitle(value);
    } else if (id === "xlabel") {
      if (canonical) setCanonicalView({ xAxisLabel: value });
      else setXLabel(value);
    } else if (id === "ylabel") {
      if (canonical) setCanonicalView({ yAxisLabel: value });
      else setYLabel(value);
    }
  }

  const textOf = (id: string): string =>
    id === "title" ? (canonicalView?.plotTitle ?? title) : id === "xlabel" ? (canonicalView?.xAxisLabel ?? xLabel) : id === "ylabel" ? (canonicalView?.yAxisLabel ?? yLabel) : "";

  /** Drag-to-place: legend -> custom figure-fraction anchor; annotation ->
   *  new data coords. Both commit through the ONE overrides object (#11). */
  function dragElement(id: string, px: number, py: number): void {
    if (!hitmap) return;
    if (id === "legend") {
      setActiveOverrides({
        ...activeOverrides,
        legend: {
          ...activeOverrides.legend,
          loc: "custom",
          anchor: pxToFigureFraction(hitmap.width, hitmap.height, px, py),
        },
      });
    } else if (id.startsWith("ann:")) {
      const i = Number(id.slice(4));
      const anns = activeOverrides.annotations ?? [];
      if (!Number.isInteger(i) || i >= anns.length) return;
      const { x, y } = pxToData(hitmap.axes, px, py);
      setActiveOverrides({
        ...activeOverrides,
        annotations: anns.map((a, j) => (j === i ? { ...a, x, y } : a)),
      });
    }
  }

  async function exportNow(): Promise<void> {
    if (canonicalDocument) {
      if (canonicalReadiness?.state !== "ready") {
        const msg = `export unavailable: ${canonicalReadiness?.error ?? "figure is not ready"}`;
        toast(msg, "danger");
        setStatus(msg);
        return;
      }
      try {
        let dataset = canonicalDataset;
        if (dataset?.pending) dataset = await useApp.getState().resolveDataset(dataset.id) ?? null;
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
      // dataset — resolve its full data first rather than silently exporting
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
