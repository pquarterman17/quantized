// The Graph Builder's apply: write (or clear) the focused plot window's
// `bindings.encoding`. Moved verbatim out of store/windowDocuments.ts in
// bundle diet slice 24: only the lazy Graph Builder calls it, so it ships
// with it instead of in the eager bundle. Import it by this path;
// windowDocuments.ts does not re-export it (architecture.test.ts,
// DRAGGED_OUT).
import type { FigureEncoding } from "../lib/figureEncoding";
import type { PlotWindow } from "../lib/plotview";
import { withPlotWindowDocument } from "./windowDocuments";

/** P1.4: set (or, with `undefined`, clear) the FOCUSED plot window's
 *  `bindings.encoding` — the Graph Builder's apply — through the declared
 *  document-write chokepoint. The same array comes back when nothing changes. */
export function withFocusedEncoding(
  windows: readonly PlotWindow[],
  focusedId: string | null,
  encoding: FigureEncoding | undefined,
): PlotWindow[] {
  let changed = false;
  const next = windows.map((window) => {
    if (window.id !== focusedId || window.kind !== "plot" || !window.document) return window;
    if (JSON.stringify(window.document.bindings.encoding) === JSON.stringify(encoding)) return window;
    changed = true;
    const { encoding: _previous, ...bindings } = window.document.bindings;
    return withPlotWindowDocument(window, {
      ...window.document,
      bindings: encoding === undefined ? bindings : { ...bindings, encoding },
    });
  });
  return changed ? next : (windows as PlotWindow[]);
}
