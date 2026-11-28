// Preferences ▸ Plot ▸ "Toolbar button labels" on the Map toolbar: keeps the captions (lib/mapToolbarLabels.ts) on
// the dock's buttons. Runs after every render of the toolbar, because the collapsed menu and the cut tools mount
// their buttons later; with the preference off, and never on, it does nothing.

import { useLayoutEffect, useRef, type RefObject } from "react";

import { syncMapToolbarLabels } from "../../lib/mapToolbarLabels";
import { toolbarPrefsSlot } from "../../store/prefs";

export function useMapToolbarLabels(dock: RefObject<HTMLElement | null>): void {
  const want = Boolean(toolbarPrefsSlot.use().showButtonLabels);
  const shown = useRef(false);
  useLayoutEffect(() => {
    if (want || shown.current) shown.current = syncMapToolbarLabels(dock.current, want);
  });
}
