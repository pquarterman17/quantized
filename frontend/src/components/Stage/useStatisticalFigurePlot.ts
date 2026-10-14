import { useCallback, useMemo } from "react";

import type { FigureDocument } from "../../lib/figureDocument";
import { frozenFigureDataset } from "../../lib/frozenFigureDataset";
import {
  figureRowsForSourceRows,
  resolveStatisticalFigureLink,
} from "../../lib/statisticalFigureLink";
import type { Dataset } from "../../lib/types";
import { selectLinkedFigureRows } from "../../store/linkedFigureSelection";
import { useApp } from "../../store/useApp";

/** Give a focused frozen statistical FigureDocument its immutable render
 * dataset and optional live source-row bridge. Keeping this out of PlotStage
 * preserves that component's thin-wrapper ceiling. */
export function useStatisticalFigurePlot(
  liveActive: Dataset | null,
  figure: FigureDocument | null | undefined,
) {
  const datasets = useApp((state) => state.datasets);
  const selection = useApp((state) => state.selection);
  const setStatus = useApp((state) => state.setStatus);
  const frozen = useMemo(() => frozenFigureDataset(figure), [figure]);
  const active = frozen ?? liveActive;
  const link = useMemo(
    () => active ? resolveStatisticalFigureLink(figure, datasets, active.id) : null,
    [active, datasets, figure],
  );
  const displaySelection = useMemo(() => link && selection?.datasetId === link.sourceId
    ? { datasetId: link.figureDatasetId, rows: figureRowsForSourceRows(link, selection.rows) }
    : null, [link, selection]);
  const onRowsSelected = useCallback((rows: number[]) => {
    if (!link) {
      setStatus("this saved figure has no current source-row link");
      return;
    }
    // Re-resolve at pointer-up: two identical rows can exchange excluded/
    // included state without changing the value fingerprint, but their source
    // row identities still differ. Never commit the pointer-down row map.
    const selectedCount = selectLinkedFigureRows(figure, link.figureDatasetId, rows);
    if (selectedCount === null) {
      setStatus("the source changed; reopen or recreate this saved result link");
      return;
    }
    setStatus(selectedCount
      ? `highlighted ${selectedCount} source row${selectedCount === 1 ? "" : "s"}`
      : "no source rows contribute to that saved result range");
  }, [figure, link, setStatus]);
  // Always intercept frozen-figure brushes. Falling back to PlotStage's
  // worksheet action would apply snapshot row numbers to an unrelated live
  // worksheet when this figure is old, unlinked, or has a missing source.
  return { active, displaySelection, onRowsSelected };
}
