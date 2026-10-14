import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { FigureDocument } from "../lib/figureDocument";
import { resolveStatisticalFigureLink, sourceRowsForFigureRows } from "../lib/statisticalFigureLink";
import { useApp } from "./useApp";

/** Set the shared worksheet brush from a frozen result figure without
 * rebinding the focused plot. This action is lazy with that specialized UI. */
export function setLinkedFigureSourceSelection(
  datasetId: string,
  rows: readonly number[],
  expectedFingerprint: string,
): boolean {
  const state = useApp.getState();
  const dataset = state.datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset || dataset.pending || analysisDataFingerprint(dataset) !== expectedFingerprint) return false;
  const clean = [...new Set(rows)]
    .filter((row) => Number.isInteger(row) && row >= 0 && row < dataset.data.time.length)
    .sort((a, b) => a - b);
  useApp.setState({ selection: clean.length ? { datasetId, rows: clean } : null });
  return true;
}

/** Atomically rebuild a saved figure's current source-row mapping and apply
 * its brush. Returns null if its live source link is no longer safe to use. */
export function selectLinkedFigureRows(
  figure: FigureDocument | null | undefined,
  figureDatasetId: string,
  figureRows: readonly number[],
): number | null {
  const link = resolveStatisticalFigureLink(figure, useApp.getState().datasets, figureDatasetId);
  if (!link) return null;
  const sourceRows = sourceRowsForFigureRows(link, figureRows);
  return setLinkedFigureSourceSelection(link.sourceId, sourceRows, link.sourceFingerprint)
    ? sourceRows.length
    : null;
}
