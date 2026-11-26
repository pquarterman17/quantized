// The measured cells the map's "Cell values" labels describe (see
// `lib/cellLabelsNative.ts`): read off the picked x/y/z columns once per
// dataset/pick, and only while the option is on (a scan's rows are walked once).
import { useMemo } from "react";

import { nativeCellGrid, type NativeCellGrid } from "../../lib/cellLabelsNative";
import type { DataStruct } from "../../lib/types";

export function useMapCellNative(
  data: DataStruct | undefined,
  keys: readonly [number, number, number],
  on: boolean,
): NativeCellGrid | null {
  const [kx, ky, kz] = keys;
  return useMemo(() => (on && data ? nativeCellGrid(data.values, [kx, ky, kz]) : null), [on, data, kx, ky, kz]);
}
