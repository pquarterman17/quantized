// Inset graph layers' curves follow their source's columns (origin gap audit
// 3 #15). A layer curve names a column of ANY dataset by index, so when that
// dataset's columns shift — a column inserted, deleted or moved
// (store/columnRemovalRefs.ts), or a column-changing re-import (by label,
// store/reimport.ts) — every layer reading it is re-pointed, in the focused
// plot's live view, every window's view and every saved editable figure. A
// curve whose column vanished becomes -1: shown as missing, never shifted
// onto a neighbour (fail closed). Pure. Eager (the column-shift guard runs
// inside the edit's own store update, so the move lands in the same undo
// step), hence written small.

import type { FigureDocument } from "./figureDocument";
import type { InsetLayer } from "./graphLayers";
import type { PlotView, PlotWindow } from "./plotview";

type Layers = PlotView["layers"];

export interface LayerHolders {
  layers: Layers;
  plotWindows: PlotWindow[];
  editableFigures: FigureDocument[];
}

/** How a window's view is read and written back through its document
 *  (store/windowDocuments' `plotWindowView` / `syncPlotWindow`). */
export interface WindowViewIO {
  view: (w: PlotWindow) => PlotView;
  sync: (w: PlotWindow, view: PlotView) => PlotWindow;
}

/** The store patch moving every layer curve that reads dataset `id` by
 *  `move` (old column index -> new, -1 = gone), over `s`. A holder with no
 *  such curve keeps its own object. */
export function layerSourcesPatch(
  s: LayerHolders,
  id: string,
  move: (c: number) => number,
  io: WindowViewIO,
): Partial<LayerHolders> {
  // A hand-edited `.dwk` can hold anything here until a reader validates it
  // (lib/graphLayers.sanitizeLayers): only real arrays are walked.
  const curvesOf = (l: unknown) => {
    const c = (l as InsetLayer | null)?.curves;
    return Array.isArray(c) ? c : null;
  };
  const reads = (ls?: Layers) => Array.isArray(ls) && ls.some((l) => curvesOf(l)?.some((c) => c?.datasetId === id));
  const mv = (ls: Layers): Layers =>
    ls.map((l) => {
      const c0 = curvesOf(l);
      return c0 ? { ...l, curves: c0.map((c) => (c?.datasetId === id ? { ...c, yKey: move(c.yKey), xKey: c.xKey == null ? c.xKey : move(c.xKey) } : c)) } : l;
    }) as Layers;
  return {
    ...(reads(s.layers) && { layers: mv(s.layers) }),
    plotWindows: s.plotWindows.map((w) => {
      const v = io.view(w);
      return reads(v.layers) ? io.sync(w, { ...v, layers: mv(v.layers) }) : w;
    }),
    editableFigures: s.editableFigures.map((d) =>
      reads(d.plot.view.layers) ? { ...d, plot: { ...d.plot, view: { ...d.plot.view, layers: mv(d.plot.view.layers) } } } : d,
    ),
  };
}
