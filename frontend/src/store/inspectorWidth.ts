// Imperative read/commit of the Inspector's resized width (the `Prefs` field
// `inspectorPanelWidth`, applied to --rw by syncPrefs). Lives in the store
// layer so the resize grip (components/Inspector/useInspectorResize.ts) stays
// off the components-level useApp.getState() ratchet.

import { useApp } from "./useApp";

export const readInspectorWidth = (): number => useApp.getState().inspectorPanelWidth;

export const commitInspectorWidth = (w: number): void =>
  useApp.getState().setPref("inspectorPanelWidth", w);
