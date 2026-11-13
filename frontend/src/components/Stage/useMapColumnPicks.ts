// The map's pickable columns and its X/Y/Z picks (figures-audit #13), moved
// out of MapStage.tsx (its 400-line component ceiling). The pickers choose
// among EVERY file column, the first (axis) column included (`mapColumns`);
// a parser 2-D map keeps its own channels, which its cut/ROI tools index.
// The picks reset per dataset to the grid-like X/Y columns and the first
// value after them (`defaultMapKeys`), and stay local to this map view.

import { useEffect, useMemo, useState } from "react";

import { defaultMapKeys, mapColumns } from "../../lib/mapdataFetch";
import type { Dataset } from "../../lib/types";

export type MapKeys = [number, number, number];

export function useMapColumnPicks(active: Dataset | null) {
  const [keys, setKeys] = useState<MapKeys>([0, 1, 2]);
  const mapActive = useMemo(
    () => (active ? { ...active, data: mapColumns(active.data) } : null),
    [active],
  );
  useEffect(() => {
    setKeys(active ? defaultMapKeys(active.data) : [0, 1, 2]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per DATASET, not per data edit
  }, [active?.id]);
  return { mapActive, keys, setKeys };
}
