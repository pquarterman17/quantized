// Polar map state hook: picks, title, format; ONE request over the active
// dataset's ANALYSIS view, previewed through /api/export/figure as a PNG and
// exported as the same request (the pie workshop's shape).

import { useMemo, useState } from "react";

import { postDownload } from "../../../lib/api/http";
import { stemFromName } from "../../../lib/exportActive";
import { analysisData } from "../../../lib/rowstate";
import { useActiveDataset } from "../../../store/useApp";
import { columnOptions } from "../ternary/auxColumns";
import { exportAuxFigure } from "../ternary/auxFigureExport";
import { useFigurePreview } from "../ternary/auxFigurePreview";
import type { AuxFigureFormat } from "../ternary/AuxFigureFrame";
import { buildPolarMapRequest, guessPolarPicks, type PolarMapPicks } from "./polarMapRequest";

export function usePolarMap() {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);
  const columns = useMemo(() => (data ? columnOptions(data) : []), [data]);
  const activeId = active?.id ?? "";
  const activeName = active?.name ?? "";
  // Picks re-guess on a dataset switch only (a row-state edit keeps them).
  const [overrides, setOverrides] = useState<{ id: string; picks: Partial<PolarMapPicks> }>({ id: "", picks: {} });
  const [title, setTitle] = useState("");
  const [fmt, setFmt] = useState<AuxFigureFormat>("pdf");
  const own = overrides.id === activeId ? overrides.picks : {};
  const guess = useMemo(() => (data ? guessPolarPicks(data) : null), [data]);
  const picks = guess ? { ...guess, ...own } : null;
  const setPick = (patch: Partial<PolarMapPicks>) =>
    setOverrides({ id: activeId, picks: { ...own, ...patch } });

  const stem = stemFromName(activeName);
  const picksKey = JSON.stringify(picks);
  const built = useMemo(
    () => (data && picks ? buildPolarMapRequest(data, picks, { title, filename: `${stem}-polarmap` }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, picksKey, title, stem],
  );
  const preview = useFigurePreview("/api/export/figure", built?.spec ?? null);

  const exportNow = () =>
    exportAuxFigure({
      build: (view, s) =>
        picks ? buildPolarMapRequest(view, picks, { title, filename: `${s}-polarmap` }).spec : null,
      send: (spec, signal) => postDownload("/api/export/figure", { ...spec, fmt }, `${spec.filename}.${fmt}`, signal),
      empty: "Nothing to draw: check the tilt, azimuth and intensity columns.",
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
    notice: built && built.dropped > 0 ? `${built.dropped} row${built.dropped === 1 ? "" : "s"} without all three values left out.` : null,
    problem: built?.problem ?? null,
    preview,
    exportNow,
  };
}
