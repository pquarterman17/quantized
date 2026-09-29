// The Semiconductor and Superconductor tabs' material presets, from the
// backend (lib/api/materialPresets) — the single copy of those tables. Empty
// until the request lands; a failed request leaves the list empty, which only
// removes the auto-fill (every card still takes typed values).

import { useEffect, useState } from "react";

import {
  semiconductorMaterials,
  superconductorMaterials,
  type SemiconductorMaterial,
  type SuperconductorMaterial,
} from "../../../lib/api/materialPresets";

function usePresetTable<T>(load: () => Promise<{ materials: Record<string, T> }>): Record<string, T> {
  const [table, setTable] = useState<Record<string, T>>({});
  useEffect(() => {
    let live = true;
    load()
      .then((r) => {
        if (live) setTable(r.materials ?? {});
      })
      .catch(() => {
        /* offline: no presets, manual entry still works */
      });
    return () => {
      live = false;
    };
  }, [load]);
  return table;
}

export function useSemiconductorPresets(): Record<string, SemiconductorMaterial> {
  return usePresetTable(semiconductorMaterials);
}

export function useSuperconductorPresets(): Record<string, SuperconductorMaterial> {
  return usePresetTable(superconductorMaterials);
}
