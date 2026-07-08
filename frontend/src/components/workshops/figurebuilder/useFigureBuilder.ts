// Figure builder state hook. Holds the publication-figure parameters, builds the
// shared request spec from the active dataset + on-screen plot state, drives a
// debounced server-rendered PNG preview, and exports at the chosen format/DPI.
// The heavy rendering is the matplotlib export route — this is a thin WYSIWYG
// layer on top of it (the export backend already existed; this adds the preview).

import { useEffect, useMemo, useState } from "react";

import { exportFigure, renderFigureHitmap, type FigureSpec } from "../../../lib/api";
import {
  deleteGraphTemplate,
  loadGraphTemplates,
  saveGraphTemplate,
  type GraphTemplate,
} from "../../../lib/figuredoc";
import { compactOverrides, type FigureOverrides } from "../../../lib/figureOverrides";
import { buildExportStyles } from "../../../lib/exportStyles";
import {
  groupForElement,
  pxToData,
  pxToFigureFraction,
  type FigureHitmap,
} from "../../../lib/previewmap";
import type { DataStruct } from "../../../lib/types";
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
  const xLog = useApp((s) => s.xLog);
  const yLog = useApp((s) => s.yLog);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const setStatus = useApp((s) => s.setStatus);
  const figureDocSeed = useApp((s) => s.figureDocSeed);
  const clearFigureDocSeed = useApp((s) => s.clearFigureDocSeed);
  const addFigureDoc = useApp((s) => s.addFigureDoc);

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
  const [docLogs, setDocLogs] = useState<{ x: boolean; y: boolean } | undefined>(undefined);
  // Frozen doc (#12): render from its data snapshot instead of the live dataset.
  const [frozenData, setFrozenData] = useState<DataStruct | null>(null);
  // User graph templates (#15).
  const [graphTemplates, setGraphTemplates] = useState<GraphTemplate[]>(() =>
    loadGraphTemplates(),
  );

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
    setDocLogs({ x: c.xLog, y: c.yLog });
    setFrozenData(!figureDocSeed.live ? (figureDocSeed.dataSnapshot ?? null) : null);
    clearFigureDocSeed();
  }, [figureDocSeed, clearFigureDocSeed]);
  const [preview, setPreview] = useState<string | null>(null);
  // The preview's element hit-map (#13) + which panel group a click focused.
  const [hitmap, setHitmap] = useState<FigureHitmap | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
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

  // The request spec shared by the preview (PNG) and the export (chosen format) —
  // mirrors the on-screen plot: channel selection, log scales, per-series styles.
  const data = frozenData ?? active?.data ?? null;
  const effXKey = docXKey !== undefined ? docXKey : (xKey ?? null);
  const effYKeys = docYKeys !== undefined ? docYKeys : yKeys;
  const effXLog = docLogs?.x ?? xLog;
  const effYLog = docLogs?.y ?? yLog;
  const spec = useMemo<FigureSpec | null>(() => {
    if (!data) return null;
    const plotted = effYKeys ?? data.labels.map((_, i) => i);
    return {
      dataset: data,
      x_key: effXKey ?? undefined,
      y_keys: effYKeys ?? undefined,
      x_log: effXLog,
      y_log: effYLog,
      style,
      overrides: compactOverrides(overrides),
      title: title.trim(),
      x_label: xLabel.trim() || undefined,
      y_label: yLabel.trim() || undefined,
      series_styles: buildExportStyles(plotted, seriesStyles),
    };
  }, [data, effYKeys, effXKey, effXLog, effYLog, style, title, xLabel, yLabel, seriesStyles, overrides]);

  // Save the current configuration as a named FigureDoc (#12). Live docs
  // reference the dataset by id; frozen docs carry the data snapshot.
  function saveAsFigure(name: string, live: boolean): void {
    if (!data) return;
    const plotted = effYKeys ?? data.labels.map((_, i) => i);
    addFigureDoc({
      id: `figd-${Date.now().toString(36)}-${++_docSeq}`,
      name,
      datasetId: active?.id ?? null,
      live,
      ...(live ? {} : { dataSnapshot: data }),
      config: {
        xKey: effXKey,
        yKeys: effYKeys,
        xLog: effXLog,
        yLog: effYLog,
        title,
        xLabel,
        yLabel,
        style,
        fmt,
        dpi,
        overrides: compactOverrides(overrides),
        seriesStyles: buildExportStyles(plotted, seriesStyles),
      },
    });
  }

  // User graph templates (#15): the style half, appliable to any figure.
  function saveStyleTemplate(name: string): void {
    if (!data) return;
    const plotted = effYKeys ?? data.labels.map((_, i) => i);
    setGraphTemplates(
      saveGraphTemplate({
        name,
        style,
        overrides: compactOverrides(overrides),
        seriesStyles: buildExportStyles(plotted, seriesStyles),
      }),
    );
    setStatus(`graph template "${name}" saved`);
  }

  function applyStyleTemplate(name: string): void {
    const t = graphTemplates.find((x) => x.name === name);
    if (!t) return;
    setStyle(t.style);
    setOverrides(t.overrides ?? {});
    setStatus(`graph template "${name}" applied`);
  }

  function removeStyleTemplate(name: string): void {
    setGraphTemplates(deleteGraphTemplate(name));
  }

  // Debounced PNG preview — re-renders on any spec change.
  useEffect(() => {
    if (!spec) {
      setPreview(null);
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
  }, [spec]);

  // ── Preview interactions (#13/#14) ────────────────────────────────────
  /** Click: focus the matching #11 panel group. */
  function selectElement(id: string): void {
    setFocusGroup(groupForElement(id));
  }

  /** Double-click inline edit commits straight into the config fields. */
  function editElementText(id: string, value: string): void {
    if (id === "title") setTitle(value);
    else if (id === "xlabel") setXLabel(value);
    else if (id === "ylabel") setYLabel(value);
  }

  const textOf = (id: string): string =>
    id === "title" ? title : id === "xlabel" ? xLabel : id === "ylabel" ? yLabel : "";

  /** Drag-to-place: legend -> custom figure-fraction anchor; annotation ->
   *  new data coords. Both commit through the ONE overrides object (#11). */
  function dragElement(id: string, px: number, py: number): void {
    if (!hitmap) return;
    if (id === "legend") {
      setOverrides({
        ...overrides,
        legend: {
          ...overrides.legend,
          loc: "custom",
          anchor: pxToFigureFraction(hitmap.width, hitmap.height, px, py),
        },
      });
    } else if (id.startsWith("ann:")) {
      const i = Number(id.slice(4));
      const anns = overrides.annotations ?? [];
      if (!Number.isInteger(i) || i >= anns.length) return;
      const { x, y } = pxToData(hitmap.axes, px, py);
      setOverrides({
        ...overrides,
        annotations: anns.map((a, j) => (j === i ? { ...a, x, y } : a)),
      });
    }
  }

  function exportNow(): void {
    if (!spec) return;
    const stem = (active?.name ?? "figure").replace(/\.[^.]+$/, "");
    exportFigure({ ...spec, fmt, dpi, filename: stem })
      .then(() => setStatus(`exported ${stem}.${fmt}`))
      .catch((e) => setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`));
  }

  return {
    active,
    fmt,
    setFmt,
    style,
    setStyle,
    dpi,
    setDpi,
    title,
    setTitle,
    xLabel,
    setXLabel,
    yLabel,
    setYLabel,
    preview,
    error,
    busy,
    exportNow,
    overrides,
    setOverrides,
    data,
    hitmap,
    focusGroup,
    selectElement,
    editElementText,
    textOf,
    dragElement,
    frozen: frozenData !== null,
    saveAsFigure,
    graphTemplates,
    saveStyleTemplate,
    applyStyleTemplate,
    removeStyleTemplate,
  };
}
