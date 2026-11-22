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

export function usePlottedPair(): PlottedPair {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const yKey = active ? plottedYKey(active, xKey, yKeys, seriesOrder) : null;
  const [excluded, filter, raw] = rowStateIdentity(active); // exclusions/filter change the analysis view
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the row-state identity IS the dependency
  const data = useMemo(() => (active ? analysisData(active) : null), [active, excluded, filter, raw]);
  const columns = useMemo(() => byCandidates(active, xKey, yKey), [active, xKey, yKey]);
  return { active, data, xKey, yKey, columns };
}
