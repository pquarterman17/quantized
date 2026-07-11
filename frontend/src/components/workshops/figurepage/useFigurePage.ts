// Figure page composer state hook (GOTO #4). Holds the page grid (rows x
// cols of slots), the panel sources assigned into them (open plot windows
// and/or saved Library figures), the page-level options (style preset,
// label format/position, export format + DPI), drives a debounced
// server-rendered low-DPI PNG preview, and exports through the same
// /api/export/figure-page route (vector PDF by default). The heavy
// composition is the matplotlib route — this is a thin WYSIWYG layer on it,
// the figure-builder pattern applied to N panels.

import { useEffect, useMemo, useState } from "react";

import {
  exportFigurePage,
  renderFigurePageBlob,
  type FigurePageSpec,
  type FigureSpec,
  type PagePanelSpec,
} from "../../../lib/api";
import { buildExportStyles } from "../../../lib/exportStyles";
import { docRenderable } from "../../../lib/figuredoc";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import {
  PAGE_MAX_GRID,
  assignSlot,
  clearSlot,
  emptySlots,
  filledCount,
  patchSlot,
  resizeSlots,
  slotLabels,
  type PageLabelFormat,
  type PageLabelPosition,
  type PageSlot,
  type PanelSource,
} from "../../../lib/figurepage";
import { displayedWindowTitle } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { FIGURE_STYLE_DPI } from "../figurebuilder/useFigureBuilder";

const PREVIEW_DPI = 90; // screen-resolution page preview; export uses the chosen DPI

/** Blob -> data: URL (FileReader, jsdom-safe — no URL.createObjectURL). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("preview read failed"));
    r.readAsDataURL(blob);
  });
}

/** Resolve one panel source into the single-figure payload the page route
 *  embeds. Reads through the store at call time: `windowsForSave()` so the
 *  FOCUSED window's live view is captured, `resolveDataset` so a pending
 *  (preview-only) dataset never exports small (#38 discipline). Returns null
 *  when the source can no longer render (window unbound, doc dataset gone). */
async function panelFigure(source: PanelSource): Promise<FigureSpec | null> {
  const s = useApp.getState();
  if (source.kind === "window") {
    const win = s.windowsForSave().find((w) => w.id === source.id);
    if (!win || win.kind !== "plot" || !win.datasetId) return null;
    const ds = await s.resolveDataset(win.datasetId);
    if (!ds) return null;
    const v = win.view;
    const plotted = v.yKeys ?? ds.data.labels.map((_, i) => i);
    return {
      dataset: ds.data,
      x_key: v.xKey ?? undefined,
      y_keys: v.yKeys ?? undefined,
      x_log: v.xLog,
      y_log: v.yLog,
      title: v.plotTitle.trim(),
      x_label: v.xAxisLabel.trim() || undefined,
      y_label: v.yAxisLabel.trim() || undefined,
      series_styles: buildExportStyles(plotted, v.seriesStyles),
    };
  }
  const doc = s.figureDocs.find((d) => d.id === source.id);
  if (!doc) return null;
  let data: DataStruct | undefined;
  if (doc.live) {
    data = doc.datasetId ? (await s.resolveDataset(doc.datasetId))?.data : undefined;
  } else {
    data = doc.dataSnapshot;
  }
  if (!data) return null;
  const c = doc.config;
  // x_breaks / margins are single-figure-only (the page composer rejects
  // them with a 422) — strip them, keep every other saved override.
  const saved: FigureOverrides = c.overrides ?? {};
  const { x_breaks: _xb, margins: _mg, ...overrides } = saved;
  return {
    dataset: data,
    x_key: c.xKey ?? undefined,
    y_keys: c.yKeys ?? undefined,
    x_log: c.xLog,
    y_log: c.yLog,
    title: c.title.trim(),
    x_label: c.xLabel.trim() || undefined,
    y_label: c.yLabel.trim() || undefined,
    series_styles: c.seriesStyles ?? undefined,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  };
}

export function useFigurePage() {
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const figureDocs = useApp((s) => s.figureDocs);
  const setStatus = useApp((s) => s.setStatus);

  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [slots, setSlots] = useState<PageSlot[]>(() => emptySlots(2, 2));
  const [labelFormat, setLabelFormat] = useState<PageLabelFormat>("(a)");
  const [labelPos, setLabelPos] = useState<PageLabelPosition>("nw");
  const [style, setStyleRaw] = useState("default");
  const [fmt, setFmt] = useState("pdf"); // vector by default
  const [dpi, setDpi] = useState(FIGURE_STYLE_DPI.default);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Panel sources: open (live, dataset-bound) plot windows + renderable
  // saved Library figures. Snapshot/worksheet/map windows are not plots.
  const windowSources = useMemo<PanelSource[]>(
    () =>
      plotWindows
        .filter((w) => w.kind === "plot" && w.datasetId !== null)
        .map((w) => ({ kind: "window", id: w.id, name: displayedWindowTitle(w, datasets) })),
    [plotWindows, datasets],
  );
  const docSources = useMemo<PanelSource[]>(
    () => figureDocs.filter(docRenderable).map((d) => ({ kind: "figdoc", id: d.id, name: d.name })),
    [figureDocs],
  );

  /** Per-slot preview labels (auto sequence in row-major order, overrides win). */
  const labels = useMemo(() => slotLabels(slots, labelFormat), [slots, labelFormat]);

  function setGrid(nextRows: number, nextCols: number): void {
    const r = Math.max(1, Math.min(PAGE_MAX_GRID, Math.round(nextRows)));
    const c = Math.max(1, Math.min(PAGE_MAX_GRID, Math.round(nextCols)));
    setSlots((prev) => resizeSlots(prev, cols, r, c));
    setRows(r);
    setCols(c);
    setSelected(null);
  }

  /** Style preset change re-syncs DPI to that preset's calibrated value
   *  (same convention as the figure builder); manual overrides stick after. */
  function setStyle(next: string): void {
    setStyleRaw(next);
    const presetDpi = FIGURE_STYLE_DPI[next];
    if (presetDpi !== undefined) setDpi(presetDpi);
  }

  function assign(i: number, source: PanelSource): void {
    setSlots((prev) => assignSlot(prev, i, source));
    setSelected(i);
  }

  /** Click a source: fill the selected slot, else the first empty one. */
  function assignToNext(source: PanelSource): void {
    const target = selected !== null ? selected : slots.findIndex((s) => s.source === null);
    if (target < 0) return;
    assign(target, source);
  }

  function clear(i: number): void {
    setSlots((prev) => clearSlot(prev, i));
  }

  function setSlotLabel(i: number, label: string | null): void {
    setSlots((prev) => patchSlot(prev, i, { label }));
  }

  function setSlotTitle(i: number, title: string | null): void {
    setSlots((prev) => patchSlot(prev, i, { title }));
  }

  /** The page spec (sans format/dpi — the preview and the export choose their
   *  own). null when nothing is assigned or nothing can render anymore. */
  async function buildSpec(): Promise<FigurePageSpec | null> {
    if (filledCount(slots) === 0) return null;
    const panels: PagePanelSpec[] = [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.source) continue;
      const figure = await panelFigure(slot.source);
      if (!figure) continue;
      panels.push({
        figure,
        row: Math.floor(i / cols),
        col: i % cols,
        ...(slot.label !== null ? { label: slot.label } : {}),
        ...(slot.title !== null ? { title: slot.title } : {}),
      });
    }
    if (panels.length === 0) return null;
    return { rows, cols, panels, style, label_format: labelFormat, label_pos: labelPos };
  }

  // Debounced low-DPI PNG preview — re-renders on any page-shape change.
  useEffect(() => {
    let cancelled = false;
    if (filledCount(slots) === 0) {
      setPreview(null);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const spec = await buildSpec();
          if (cancelled) return;
          if (!spec) {
            setPreview(null);
            setError(null);
            return;
          }
          const blob = await renderFigurePageBlob({ ...spec, fmt: "png", dpi: PREVIEW_DPI });
          const url = await blobToDataUrl(blob);
          if (!cancelled) {
            setPreview(url);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "preview failed");
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // buildSpec reads only state listed here (slots/rows/cols/style/labels).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, rows, cols, style, labelFormat, labelPos]);

  async function exportNow(): Promise<void> {
    try {
      const spec = await buildSpec();
      if (!spec) {
        setStatus("assign at least one panel to export a figure page");
        return;
      }
      await exportFigurePage({ ...spec, fmt, dpi });
      setStatus(`exported figure_page.${fmt}`);
    } catch (e) {
      setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  return {
    rows,
    cols,
    setGrid,
    slots,
    labels,
    selected,
    setSelected,
    assign,
    assignToNext,
    clear,
    setSlotLabel,
    setSlotTitle,
    labelFormat,
    setLabelFormat,
    labelPos,
    setLabelPos,
    style,
    setStyle,
    fmt,
    setFmt,
    dpi,
    setDpi,
    windowSources,
    docSources,
    preview,
    error,
    busy,
    buildSpec,
    exportNow,
  };
}
