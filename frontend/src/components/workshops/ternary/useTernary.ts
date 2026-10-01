// Ternary diagram workshop — state hook (the React analogue of the MATLAB
// workshop pattern). Owns the three composition picks, the optional colour
// pick, title and export format; derives ONE request from the active
// dataset's ANALYSIS view (lib/rowstate.analysisData: excluded and filtered
// rows already gone), previews it through the route as a PNG and exports
// that same request. The view stays thin.

import { useEffect, useMemo, useState } from "react";

import { exportTernaryFigure } from "../../../lib/api/figures";
import { stemFromName } from "../../../lib/exportActive";
import { analysisData } from "../../../lib/rowstate";
import { useActiveDataset } from "../../../store/useApp";
import { columnOptions, defaultPicks, type AuxColumn } from "./auxColumns";
import { exportAuxFigure } from "./auxFigureExport";
import { useFigurePreview, type FigurePreview } from "./auxFigurePreview";
import type { AuxFigureFormat } from "./AuxFigureFrame";
import { buildTernaryRequest, droppedRowsNotice, type TernaryPicks } from "./ternaryRequest";

export interface TernaryState {
  hasData: boolean;
  columns: AuxColumn[];
  picks: TernaryPicks;
  setPick: (key: keyof TernaryPicks, index: number | null) => void;
  title: string;
  setTitle: (title: string) => void;
  fmt: AuxFigureFormat;
  setFmt: (fmt: AuxFigureFormat) => void;
  /** One sentence on rows left out, or null. */
  notice: string | null;
  /** Why nothing can be drawn, or null. */
  problem: string | null;
  preview: FigurePreview;
  exportNow: () => Promise<void>;
}

const NO_ROWS = "No row has a drawable composition.";

export function useTernary(): TernaryState {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);
  const activeId = active?.id ?? null;
  const activeName = active?.name ?? "";

  const columns = useMemo(() => (data ? columnOptions(data) : []), [data]);
  const [picks, setPicks] = useState<TernaryPicks>({ a: 0, b: 1, c: 2, colorBy: null });
  const [title, setTitle] = useState("");
  const [fmt, setFmt] = useState<AuxFigureFormat>("pdf");

  // Column indices from the PREVIOUS dataset would silently plot the wrong
  // columns, so re-derive the picks whenever the active dataset changes.
  useEffect(() => {
    if (!data) return;
    const [a, b, c] = defaultPicks(data, 3);
    setPicks({ a, b, c, colorBy: null });
    setTitle(activeName);
    // The dataset's identity and name are the reset triggers; `data` is
    // re-read each time but must not reset picks on a row-state edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeName]);

  const stem = stemFromName(activeName);
  const built = useMemo(
    () => (data ? buildTernaryRequest(data, picks, { title, filename: `${stem}-ternary` }) : null),
    [data, picks, title, stem],
  );
  const preview = useFigurePreview("/api/export/ternary-figure", built?.spec ?? null);

  const exportNow = () =>
    exportAuxFigure({
      build: (view, s) => buildTernaryRequest(view, picks, { title, filename: `${s}-ternary` }).spec,
      send: (spec, signal) => exportTernaryFigure({ ...spec, fmt }, signal),
      empty: NO_ROWS,
    });

  return {
    hasData: !!data,
    columns,
    picks,
    setPick: (key, index) => setPicks((p) => ({ ...p, [key]: index })),
    title,
    setTitle,
    fmt,
    setFmt,
    notice: built ? droppedRowsNotice(built.dropped, built.total) : null,
    problem: built && !built.spec ? NO_ROWS : null,
    preview,
    exportNow,
  };
}
