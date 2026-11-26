// Insert > Slope / Distance / Angle / Scale bar: the menu-driven counterpart of
// the toolbar flyout's measurement tools (lib/annotationMeasure.ts). Registered
// only in the full command list (appCommands.ts), not the first-paint core one:
// only the menus and the palette read it. Derived from the flyout's own list so
// the two never drift (and the labels are stored once).
import { isMeasureKind } from "../lib/shapeMeasureFields";
import { SHAPE_TOOLS } from "../lib/plotToolbarDefs";
import type { Action } from "../store/commands";
import { useApp } from "../store/useApp";

// Their own help copy (not in commandDocs.ts, which is the table for the CORE commands only).
const DOCS: Record<string, { description: string; keywords: string }> = {
  slope: { description: "Drag a line on the plot to read its slope; on log axes it reads the power-law exponent.", keywords: "exponent power law measure triangle" },
  distance: { description: "Drag between two points to read their distance with its X and Y components.", keywords: "measure length delta" },
  angle: { description: "Draw two arms from a vertex and read the angle between them in degrees.", keywords: "measure degrees" },
  scalebar: { description: "Draw a horizontal or vertical bar of a set length in data units, labelled.", keywords: "scale bar micrograph map length" },
};

export const measureInsertCommands: Action[] = SHAPE_TOOLS.filter((t) => isMeasureKind(t.kind)).map(({ kind, label }) => ({
  id: `insert-${kind}`,
  group: "Insert",
  label,
  ...DOCS[kind],
  run: () => useApp.getState().setDrawShapeKind(kind),
}));
