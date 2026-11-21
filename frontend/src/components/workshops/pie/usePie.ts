// Pie / doughnut workshop — state hook (the ternary workshop's shape). Owns
// the label pick, the value columns (one ring each), the hole, title and
// export format; derives ONE request from the active dataset's ANALYSIS view,
// previews it through the route as a PNG and exports that same request.
// An applied Origin pie / doughnut figure hands its columns and hole over
// through lib/piePending. Wedge colours are the theme's series tokens
// (`--series-N`), resolved to hex for matplotlib.

import { useEffect, useMemo, useState } from "react";

import { postDownload } from "../../../lib/api/http";
import { resolveToHex } from "../../../lib/color";
import { stemFromName } from "../../../lib/exportActive";
import { takePie } from "../../../lib/piePending";
import { analysisData } from "../../../lib/rowstate";
import { cssVar, SERIES_VARS } from "../../../lib/seriesStyleCycle";
import { useActiveDataset } from "../../../store/useApp";
import { columnOptions, type AuxColumn } from "../ternary/auxColumns";
import { exportAuxFigure } from "../ternary/auxFigureExport";
import { useFigurePreview, type FigurePreview } from "../ternary/auxFigurePreview";
import type { AuxFigureFormat } from "../ternary/AuxFigureFrame";
import { buildPieRequest, droppedPieRows, type PiePicks } from "./pieRequest";

export interface PieState {
  hasData: boolean;
  columns: AuxColumn[];
  picks: PiePicks;
  setLabels: (index: number) => void;
  /** Replace ring `k`'s column; `null` removes that ring. */
  setRing: (k: number, index: number | null) => void;
  addRing: () => void;
  setHole: (hole: number) => void;
  title: string;
  setTitle: (title: string) => void;
  fmt: AuxFigureFormat;
  setFmt: (fmt: AuxFigureFormat) => void;
  notice: string | null;
  problem: string | null;
  preview: FigurePreview;
  exportNow: () => Promise<void>;
}

const NO_ROWS = "No row has a drawable value.";

/** The theme's series colours as hex (null when the browser cannot resolve them). */
export function themeSeriesHex(): string[] | null {
  const out = SERIES_VARS.map((v) => resolveToHex(cssVar(v)));
  return out.every((c): c is string => !!c) ? out : null;
}

export function usePie(): PieState {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);
  const activeId = active?.id ?? null;
  const activeName = active?.name ?? "";
  const columns = useMemo(() => (data ? columnOptions(data) : []), [data]);
  const [picks, setPicks] = useState<PiePicks>({ labels: -1, values: [0], hole: 0 });
  const [title, setTitle] = useState("");
  const [fmt, setFmt] = useState<AuxFigureFormat>("pdf");
  const colors = useMemo(() => themeSeriesHex(), []);

  useEffect(() => {
    if (!data) return;
    // An applied Origin pie names its label / value columns and hole (lib/piePending).
    const req = takePie(activeId);
    setPicks(req ? { labels: req.labels, values: req.values, hole: req.hole } : { labels: -1, values: [0], hole: 0 });
    setTitle(activeName);
    // Reset only on a dataset switch, never on a row-state edit (useTernary).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeName]);

  const stem = stemFromName(activeName);
  const built = useMemo(
    () => (data ? buildPieRequest(data, picks, { title, filename: `${stem}-pie`, colors }) : null),
    [data, picks, title, stem, colors],
  );
  const preview = useFigurePreview("/api/export/pie-figure", built?.spec ?? null);

  const exportNow = () =>
    exportAuxFigure({
      build: (view, s) => buildPieRequest(view, picks, { title, filename: `${s}-pie`, colors }).spec,
      send: (spec, signal) => postDownload("/api/export/pie-figure", { ...spec, fmt }, `${spec.filename}.${fmt}`, signal),
      empty: NO_ROWS,
    });

  return {
    hasData: !!data,
    columns,
    picks,
    setLabels: (labels) => setPicks((p) => ({ ...p, labels })),
    setRing: (k, index) =>
      setPicks((p) => {
        const values = index === null ? p.values.filter((_, i) => i !== k) : p.values.map((v, i) => (i === k ? index : v));
        return { ...p, values: values.length > 0 ? values : p.values };
      }),
    addRing: () => setPicks((p) => ({ ...p, values: [...p.values, p.values[p.values.length - 1] ?? 0] })),
    setHole: (hole) => setPicks((p) => ({ ...p, hole })),
    title,
    setTitle,
    fmt,
    setFmt,
    notice: built ? droppedPieRows(built.dropped, built.total) : null,
    problem: built && !built.spec ? NO_ROWS : null,
    preview,
    exportNow,
  };
}
