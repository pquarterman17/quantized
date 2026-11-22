// The active worksheet, its analysis view and the plotted X/primary-Y pair the
// single-curve tools run on, plus the By grouping candidates for that pair.

import { useMemo } from "react";

import { plottedYKey } from "../../../lib/fitselectionActions";
import { analysisData, rowStateIdentity } from "../../../lib/rowstate";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import type { ByColumnOption } from "../useByPartition";
import { byCandidates } from "./byLevelPairs";

export interface PlottedPair {
  active: Dataset | null;
  data: DataStruct | null;
  xKey: number | null;
  yKey: number | null;
  columns: ByColumnOption[];
}

/** The analysis view of `active` (never the raw data), memoised on the row-state identity. */
export function useAnalysisView(active: Dataset | null): DataStruct | null {
  const [excluded, filter, raw] = rowStateIdentity(active); // exclusions/filter change the analysis view
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the row-state identity IS the dependency
  return useMemo(() => (active ? analysisData(active) : null), [active, excluded, filter, raw]);
}

/** By for a tool that picks its own columns (surface fit, optical gap,
 *  ellipse fit): the active worksheet, its analysis view and every column
 *  except the picked ones as grouping candidates. */
export function usePickedBy(picks: readonly number[]): Omit<PlottedPair, "xKey" | "yKey"> {
  const active = useActiveDataset();
  const data = useAnalysisView(active);
  const key = picks.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the picks' identity
  const columns = useMemo(() => (active ? active.data.labels.map((label, index) => ({ index, label })).filter((c) => !picks.includes(c.index)) : []), [active, key]);
  return { active, data, columns };
}

export function usePlottedPair(): PlottedPair {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const yKey = active ? plottedYKey(active, xKey, yKeys, seriesOrder) : null;
  const data = useAnalysisView(active);
  const columns = useMemo(() => byCandidates(active, xKey, yKey), [active, xKey, yKey]);
  return { active, data, xKey, yKey, columns };
}
