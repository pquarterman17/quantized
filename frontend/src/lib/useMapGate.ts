// Warm the lazy Map grid gate (lib/mapdata.ts `ensureMapGate`) for a dataset
// and re-render when any gate result lands. For a surface that reports map
// availability (plot-type gallery, Analysis Center): `canRenderMap` fails
// closed until the gate has run, so without this a first open would show a
// gridded XYZ dataset's Contour / RSM tools as unavailable (UX-D review).
// Returns the gate version so a `useMemo` can list it as a dependency.

import { useEffect, useSyncExternalStore } from "react";

import { ensureMapGate, mapGateVersion, subscribeMapGate } from "./mapdata";
import type { DataStruct } from "./types";

export function useMapGate(data: DataStruct | null | undefined): number {
  const version = useSyncExternalStore(subscribeMapGate, mapGateVersion);
  useEffect(() => void ensureMapGate(data), [data]);
  return version;
}
