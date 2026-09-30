// Facet-grid tiling, split out of lib/multipanel.ts (bundle diet slice 12,
// plans/BUNDLE_HEADROOM.md) as a leaf: lib/panelwindow.ts (then eager — the
// panel-window model) needs only this, while the rest of multipanel.ts is
// reached from the lazy multi-panel stage renderers and exporters. Moved
// verbatim; multipanel.ts re-exports it. Since slice 13 only the lazy
// panel-window renderer reaches it (the eager record half of panelwindow.ts
// is lib/panelWindowModel.ts).

/** Grid dimensions for tiling `n` HOMOGENEOUS small-multiples panels (facet
 *  grid, gap #21 residual) as close to square as possible. Unlike
 *  `spatialGridSize`, a facet panel carries no real page-position — the tiling
 *  is computed here, not decoded — so this takes a plain count instead of a
 *  panel array. Same sqrt-balance `GraphPreview.tsx`'s own facet preview grid
 *  uses; kept as a small standalone helper rather than a shared import since
 *  that file is outside this module's lane. 1x1 for n<=0 (mirrors
 *  `spatialGridSize`'s empty-set fallback). */
export function facetGridSize(n: number): { rows: number; cols: number } {
  if (n <= 0) return { rows: 1, cols: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { rows, cols };
}
