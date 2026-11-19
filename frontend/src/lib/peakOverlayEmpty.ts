// One rule for "this peak overlay carries no peaks": its marker column is all
// null (Find peaks opened, nothing found/fitted yet). The canvas
// (plotdata.withPeakOverlay) and the export (figureSpecOverlays) both skip such
// an overlay, so neither shows a bare "peaks" legend row / series.
import type { PeakOverlay } from "./fitTypes";

export function peakOverlayEmpty(o: Pick<PeakOverlay, "y"> | null | undefined): boolean {
  return !o || !o.y.some((v) => v != null && Number.isFinite(v));
}
