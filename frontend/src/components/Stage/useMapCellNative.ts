// The measured cells the map's "Cell values" labels describe (see
// `lib/cellLabelsNative.ts`): read off the picked x/y/z columns once per
// dataset/pick, and only while the option is on (a scan's rows are walked once).
import { useEffect, useMemo } from "react";

import { nativeCellGrid, type NativeCellGrid } from "../../lib/cellLabelsNative";
import { publishCellGridKind } from "../../lib/cellLabelGridKind";
import type { DataStruct } from "../../lib/types";

export function useMapCellNative(
  data: DataStruct | undefined,
  keys: readonly [number, number, number],
  on: boolean,
  /** The dataset this map shows: the Inspector's note says which grid the labels describe. */
  datasetId?: string,
): NativeCellGrid | null {
  const [kx, ky, kz] = keys;
  const grid = useMemo(() => (on && data ? nativeCellGrid(data.values, [kx, ky, kz]) : null), [on, data, kx, ky, kz]);
  useEffect(() => {
    if (!datasetId) return;
    publishCellGridKind(datasetId, on && data ? (grid ? "measured" : "display") : null);
    return () => publishCellGridKind(datasetId, null);
  }, [datasetId, on, data, grid]);
  return grid;
}
