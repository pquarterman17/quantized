// Vector field workshop — state hook. Owns the X/Y/U/V picks, the quiver/
// streamline mode, title and export format; derives ONE gridded request from
// the active dataset's ANALYSIS view (excluded and filtered rows already
// gone), previews it through the route as a PNG and exports that same
// request. The view stays thin.

import { useEffect, useMemo, useState } from "react";

import { exportFieldFigure } from "../../../lib/api/figures";
import { stemFromName } from "../../../lib/exportActive";
import { analysisData } from "../../../lib/rowstate";
import { useActiveDataset } from "../../../store/useApp";
import { columnOptions, defaultPicks, type AuxColumn } from "../ternary/auxColumns";
import { exportAuxFigure } from "../ternary/auxFigureExport";
import { useFigurePreview, type FigurePreview } from "../ternary/auxFigurePreview";
import type { AuxFigureFormat } from "../ternary/AuxFigureFrame";
import { buildFieldRequest, droppedFieldRowsNotice, type FieldPicks } from "./fieldRequest";

export type FieldKind = "quiver" | "streamline";

export interface FieldPlotState {
  hasData: boolean;
  columns: AuxColumn[];
  picks: FieldPicks;
  setPick: (key: keyof FieldPicks, index: number) => void;
  kind: FieldKind;
  setKind: (kind: FieldKind) => void;
  title: string;
  setTitle: (title: string) => void;
  fmt: AuxFigureFormat;
  setFmt: (fmt: AuxFigureFormat) => void;
  notice: string | null;
  problem: string | null;
  preview: FigurePreview;
  exportNow: () => Promise<void>;
}

export function useFieldPlot(): FieldPlotState {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);
  const activeId = active?.id ?? null;
  const activeName = active?.name ?? "";

  const columns = useMemo(() => (data ? columnOptions(data) : []), [data]);
  const [picks, setPicks] = useState<FieldPicks>({ x: 0, y: 1, u: 2, v: 3 });
  const [kind, setKind] = useState<FieldKind>("quiver");
  const [title, setTitle] = useState("");
  const [fmt, setFmt] = useState<AuxFigureFormat>("pdf");

  // Column indices from the PREVIOUS dataset would silently plot the wrong
  // columns, so re-derive the picks whenever the active dataset changes.
  useEffect(() => {
    if (!data) return;
    const [x, y, u, v] = defaultPicks(data, 4);
    setPicks({ x, y, u, v });
    setTitle(activeName);
    // The dataset's identity and name are the reset triggers; a row-state
    // edit re-reads `data` but must not reset the picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeName]);

  const stem = stemFromName(activeName);
  const built = useMemo(
    () => (data ? buildFieldRequest(data, picks, { kind, title, filename: `${stem}-field` }) : null),
    [data, picks, kind, title, stem],
  );
  const preview = useFigurePreview("/api/export/field-figure", built?.spec ?? null);

  const exportNow = () =>
    exportAuxFigure({
      build: (view, s) => buildFieldRequest(view, picks, { kind, title, filename: `${s}-field` }).spec,
      send: (spec, signal) => exportFieldFigure({ ...spec, fmt }, signal),
      empty: built?.error ?? "No field can be drawn.",
    });

  return {
    hasData: !!data,
    columns,
    picks,
    setPick: (key, index) => setPicks((p) => ({ ...p, [key]: index })),
    kind,
    setKind,
    title,
    setTitle,
    fmt,
    setFmt,
    notice: built ? droppedFieldRowsNotice(built.dropped, built.total) : null,
    problem: built?.error ?? null,
    preview,
    exportNow,
  };
}
