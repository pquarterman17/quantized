// Hands a mounted map's own export to the figure commands (lib/mapExportBridge.ts), keyed by its
// window id, or the classic Map tab's key when it has none. The latest `run` is always the one
// called, so a re-render never leaves a stale canvas or payload behind.

import { useEffect, useRef } from "react";

import { registerMapExporter, STAGE_MAP_KEY } from "../../lib/mapExportBridge";

export function useRegisterMapExporter(windowId: string | undefined, run: () => void): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => registerMapExporter(windowId ?? STAGE_MAP_KEY, () => latest.current()), [windowId]);
}
