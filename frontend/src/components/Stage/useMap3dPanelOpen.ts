// The 3-D panel's open state: starts from the remembered choice (closed the first
// time) and writes every change back. Kept out of MapToolbar to leave it room.

import { useCallback, useState } from "react";

import { loadMap3dPanelOpen, saveMap3dPanelOpen } from "../../lib/map3dPanelPrefs";

export function useMap3dPanelOpen(): [boolean, (open: boolean | ((v: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(loadMap3dPanelOpen);
  const set = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setOpen((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (value !== prev) saveMap3dPanelOpen(value);
      return value;
    });
  }, []);
  return [open, set];
}
