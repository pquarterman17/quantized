// G15 plots state hook: picks, title, format; ONE request over the active
// dataset's ANALYSIS view, previewed through /api/export/figure as a PNG and
// exported as the same request (polarmap/usePolarMap.ts's shape).

import { useMemo, useState } from "react";

import { postDownload } from "../../../lib/api/http";
import { stemFromName } from "../../../lib/exportActive";
import type { Plots2Kind } from "../../../lib/plots2Mode";
import { analysisData } from "../../../lib/rowstate";
import { useActiveDataset } from "../../../store/useApp";
import { columnOptions } from "../ternary/auxColumns";
import { exportAuxFigure } from "../ternary/auxFigureExport";
import { useWindowedActive } from "../ternary/auxRowWindow";
import { useFigurePreview } from "../ternary/auxFigurePreview";
import type { AuxFigureFormat } from "../ternary/AuxFigureFrame";
import { buildPlots2Request, guessPlots2Picks, type Plots2Picks } from "./plots2Request";
import { AUX_EXPORT_FORMATS, exportFormatFor } from "../../../lib/exportPrefs";

export function usePlots2(kind: Plots2Kind) {
  const active = useActiveDataset();
  const { sheet, windowProblem } = useWindowedActive(active); // the plot's row window: the figure is drawn from the window's rows
  const data = useMemo(() => analysisData(sheet), [sheet]);
  const columns = useMemo(() => (data ? columnOptions(data) : []), [data]);
  const activeId = active?.id ?? "";
  const activeName = active?.name ?? "";
  // Picks re-guess on a dataset switch only (a row-state edit keeps them).
  const [overrides, setOverrides] = useState<{ id: string; picks: Partial<Plots2Picks> }>({ id: "", picks: {} });
  const [title, setTitle] = useState("");
  const [fmt, setFmt] = useState<AuxFigureFormat>(() => exportFormatFor(AUX_EXPORT_FORMATS) as AuxFigureFormat);
  const own = overrides.id === activeId ? overrides.picks : {};
  const guess = useMemo(() => (data ? guessPlots2Picks(data) : null), [data]);
  const picks = guess ? { ...guess, ...own } : null;
  const setPick = (patch: Partial<Plots2Picks>) => setOverrides({ id: activeId, picks: { ...own, ...patch } });

  const stem = stemFromName(activeName);
  const picksKey = JSON.stringify(picks);
  const built = useMemo(
    () => (data && picks ? buildPlots2Request(data, kind, picks, { title, filename: `${stem}-${kind}` }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, kind, picksKey, title, stem],
  );
  const preview = useFigurePreview("/api/export/figure", built?.spec ?? null);

  const exportNow = () =>
    exportAuxFigure({
      rowWindow: true,
      build: (view, s) => (picks ? buildPlots2Request(view, kind, picks, { title, filename: `${s}-${kind}` }).spec : null),
      send: (spec, signal) => postDownload("/api/export/figure", { ...spec, fmt }, `${spec.filename}.${fmt}`, signal),
      empty: "Nothing to draw: check the picked columns.",
    });

  return {
    hasData: !!data,
    columns,
    picks,
    setPick,
    title,
    setTitle,
    fmt,
    setFmt,
    notice: built && built.dropped > 0 ? `${built.dropped} row${built.dropped === 1 ? "" : "s"} without every picked value left out.` : null,
    problem: windowProblem ?? built?.problem ?? null,
    preview,
    exportNow,
  };
}
