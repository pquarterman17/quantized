// Figure builder state hook. Holds the publication-figure parameters, builds the
// shared request spec from the active dataset + on-screen plot state, drives a
// debounced server-rendered PNG preview, and exports at the chosen format/DPI.
// The heavy rendering is the matplotlib export route — this is a thin WYSIWYG
// layer on top of it (the export backend already existed; this adds the preview).

import { useEffect, useMemo, useRef, useState } from "react";

import { exportFigure, type FigureSpec, renderFigureBlob } from "../../../lib/api";
import { compactOverrides, type FigureOverrides } from "../../../lib/figureOverrides";
import { buildExportStyles } from "../../../lib/exportStyles";
import { useActiveDataset, useApp } from "../../../store/useApp";

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
const PREVIEW_DPI = 110; // screen-resolution preview; export uses the chosen DPI

export function useFigureBuilder() {
  const active = useActiveDataset();
  const yKeys = useApp((s) => s.yKeys);
  const xKey = useApp((s) => s.xKey);
  const xLog = useApp((s) => s.xLog);
  const yLog = useApp((s) => s.yLog);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const setStatus = useApp((s) => s.setStatus);

  const [fmt, setFmt] = useState("pdf");
  const [style, setStyle] = useState("default");
  const [dpi, setDpi] = useState(300);
  const [title, setTitle] = useState("");
  const [xLabel, setXLabel] = useState("");
  const [yLabel, setYLabel] = useState("");
  // Property-panel overrides (#11): one config object, folded into the spec.
  const [overrides, setOverrides] = useState<FigureOverrides>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);

  // The request spec shared by the preview (PNG) and the export (chosen format) —
  // mirrors the on-screen plot: channel selection, log scales, per-series styles.
  const spec = useMemo<FigureSpec | null>(() => {
    if (!active) return null;
    const plotted = yKeys ?? active.data.labels.map((_, i) => i);
    return {
      dataset: active.data,
      x_key: xKey ?? undefined,
      y_keys: yKeys ?? undefined,
      x_log: xLog,
      y_log: yLog,
      style,
      overrides: compactOverrides(overrides),
      title: title.trim(),
      x_label: xLabel.trim() || undefined,
      y_label: yLabel.trim() || undefined,
      series_styles: buildExportStyles(plotted, seriesStyles),
    };
  }, [active, yKeys, xKey, xLog, yLog, style, title, xLabel, yLabel, seriesStyles, overrides]);

  // Debounced PNG preview — re-renders on any spec change.
  useEffect(() => {
    if (!spec) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      renderFigureBlob({ ...spec, fmt: "png", dpi: PREVIEW_DPI })
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = url;
          setPreview(url);
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

  // Revoke the last object URL when the builder closes.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function exportNow(): void {
    if (!spec || !active) return;
    const stem = active.name.replace(/\.[^.]+$/, "");
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
  };
}
