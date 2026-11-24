// Whether the polar Stage shows the polar MAP (heatmap/contour of I(chi, phi),
// GAP_AUDIT_9 G2) instead of polar lines. A session-only view flag, like the
// aux-figure open flags: nothing here is stored on the document. The "Polar
// map" plot-type tile sets it (lib/figureDialogActions.ts); the lazily-loaded
// PolarStage reads it. Kept as a ~20-line external store so neither side
// pulls the other's chunk into the eager bundle.

let on = false;
const listeners = new Set<() => void>();

export function setPolarMapMode(next: boolean): void {
  if (next === on) return;
  on = next;
  listeners.forEach((l) => l());
}

export function getPolarMapMode(): boolean {
  return on;
}

export function subscribePolarMapMode(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
