// Insert > Slope / Distance / Angle / Scale bar: the menu-driven counterpart of
// the toolbar flyout's measurement tools (lib/annotationMeasure.ts). Kept out of
// plotCommands.ts, which sits near its line ceiling.
import type { Action } from "../store/commands";
import { useApp } from "../store/useApp";

const KINDS = [
  ["slope", "Slope"],
  ["distance", "Distance"],
  ["angle", "Angle"],
  ["scalebar", "Scale bar"],
] as const;

export const measureInsertCommands: Action[] = KINDS.map(([kind, label]) => ({
  id: `insert-${kind}`,
  group: "Insert",
  label,
  run: () => useApp.getState().setDrawShapeKind(kind),
}));
