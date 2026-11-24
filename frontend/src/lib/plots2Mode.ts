// Which G15 plot (parallel coordinates, hexbin, 2-D KDE, Pareto, Bland-Altman)
// the Plot stage shows instead of the XY canvas, or null. Session-only view
// flag in the polarMapMode.ts mould: nothing here is stored on the document.
// The plot-type tiles set it (lib/figureDialogActions.ts); the lazily loaded
// Plots2Stage (components/workshops/plots2) reads it. A ~20-line external
// store so neither side pulls the other's chunk into the eager bundle.

export type Plots2Kind = "parallel" | "hexbin" | "kde2d" | "pareto" | "blandAltman";

let kind: Plots2Kind | null = null;
const listeners = new Set<() => void>();

export function setPlots2Mode(next: Plots2Kind | null): void {
  if (next === kind) return;
  kind = next;
  listeners.forEach((l) => l());
}

export function getPlots2Mode(): Plots2Kind | null {
  return kind;
}

export function subscribePlots2Mode(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
