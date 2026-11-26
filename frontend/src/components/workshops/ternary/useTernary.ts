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
import { takeTernaryPicks } from "../../../lib/ternaryPending";
import { DEFAULT_TERNARY_FIELD, type TernaryField, type TernarySaved } from "../../../lib/ternaryProject";
import { useAuxFigureStore } from "./auxFigureStore";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { columnOptions, compositionPicks, type AuxColumn } from "./auxColumns";
import { exportAuxFigure } from "./auxFigureExport";
import { useFigurePreview, type FigurePreview } from "./auxFigurePreview";
import type { AuxFigureFormat } from "./AuxFigureFrame";
import { buildTernaryRequest, droppedRowsNotice, type TernaryPicks } from "./ternaryRequest";
import { AUX_EXPORT_FORMATS, exportFormatFor } from "../../../lib/exportPrefs";

export interface TernaryState {
  hasData: boolean;
  columns: AuxColumn[];
  picks: TernaryPicks;
  setPick: (key: keyof TernaryPicks, index: number | null) => void;
  /** How the composition is drawn (scatter / contour / heatmap and options). */
  field: TernaryField;
  setField: (patch: Partial<TernaryField>) => void;
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
const NO_Z = "Pick the Z column the map is coloured by.";

/** Saved picks that still name columns this dataset has. */
function usable(saved: TernarySaved | undefined, columnCount: number): TernarySaved | null {
  if (!saved) return null;
  const { a, b, c, colorBy } = saved.picks;
  return [a, b, c, colorBy ?? -1].every((i) => i < columnCount) ? saved : null;
}

export function useTernary(): TernaryState {
  const active = useActiveDataset();
  // Read in the reset effect below (keyed on the dataset, so a later edit does not re-run it).
  const savedFigures = useApp((s) => s.ternaryFigures);
  const saveFigure = useApp((s) => s.saveTernaryFigure);
  const data = useMemo(() => analysisData(active), [active]);
  const activeId = active?.id ?? null;
  const activeName = active?.name ?? "";

  const columns = useMemo(() => (data ? columnOptions(data) : []), [data]);
  const [picks, setPicks] = useState<TernaryPicks>({ a: 0, b: 1, c: 2, colorBy: null });
  const [field, setFieldState] = useState<TernaryField>(DEFAULT_TERNARY_FIELD);
  const [title, setTitle] = useState("");
  const [fmt, setFmt] = useState<AuxFigureFormat>(() => exportFormatFor(AUX_EXPORT_FORMATS) as AuxFigureFormat);

  // Column indices from the PREVIOUS dataset would silently plot the wrong
  // columns, so re-derive the picks whenever the active dataset changes.
  useEffect(() => {
    if (!data) return;
    // An applied Origin ternary figure names its A, B, C columns (lib/ternaryPending).
    const req = takeTernaryPicks(activeId);
    // An explicit Origin apply wins; else this dataset's saved choices (they
    // come back with the project); else the sheet's own first columns.
    const saved = req ? null : usable(savedFigures[activeId ?? ""], data.labels.length);
    const [a, b, c] = req ? [req.a, req.b, req.c] : compositionPicks(data, 3);
    setPicks(saved ? saved.picks : { a, b, c, colorBy: null });
    setFieldState(saved ? saved.field : DEFAULT_TERNARY_FIELD);
    setTitle(activeName);
    // The dataset's identity and name are the reset triggers; `data` is
    // re-read each time but must not reset picks on a row-state edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeName]);

  // The gallery's "Ternary map" tile asks for a map kind; with no Z column
  // yet, the first channel after the composition is the obvious choice.
  const kindHint = useAuxFigureStore((s) => s.ternaryKindHint);
  useEffect(() => {
    if (!kindHint || !data) return;
    useAuxFigureStore.setState({ ternaryKindHint: null });
    const nextField = { ...field, kind: kindHint };
    const nextPicks = picks.colorBy === null && kindHint !== "scatter" ? { ...picks, colorBy: defaultZ(data.labels.length, picks) } : picks;
    commit(nextPicks, nextField);
    // Reacts only to a NEW hint; the rest is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindHint]);

  /** Apply a user choice AND remember it for this dataset (project-saved). */
  function commit(nextPicks: TernaryPicks, nextField: TernaryField): void {
    setPicks(nextPicks);
    setFieldState(nextField);
    if (activeId) saveFigure(activeId, { picks: nextPicks, field: nextField });
  }

  const stem = stemFromName(activeName);
  const built = useMemo(
    () => (data ? buildTernaryRequest(data, picks, { title, filename: `${stem}-ternary`, field }) : null),
    [data, picks, title, stem, field],
  );
  const preview = useFigurePreview("/api/export/ternary-figure", built?.spec ?? null);

  const exportNow = () =>
    exportAuxFigure({
      build: (view, s) => buildTernaryRequest(view, picks, { title, filename: `${s}-ternary`, field }).spec,
      send: (spec, signal) => exportTernaryFigure({ ...spec, fmt }, signal),
      empty: NO_ROWS,
    });

  return {
    hasData: !!data,
    columns,
    picks,
    setPick: (key, index) => commit({ ...picks, [key]: index }, field),
    field,
    setField: (patch) => commit(picks, { ...field, ...patch }),
    title,
    setTitle,
    fmt,
    setFmt,
    notice: built ? droppedRowsNotice(built.dropped, built.total) : null,
    problem: built && !built.spec ? (field.kind !== "scatter" && picks.colorBy === null ? NO_Z : NO_ROWS) : null,
    preview,
    exportNow,
  };
}

/** A sensible Z for a map: the first channel not already a composition pick. */
function defaultZ(channelCount: number, p: TernaryPicks): number | null {
  for (let i = 0; i < channelCount; i++) if (i !== p.a && i !== p.b && i !== p.c) return i;
  return null;
}
