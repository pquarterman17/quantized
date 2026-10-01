// Plot Recipe preview thumbnail (F4.2 / audit P1.3). Draws a recipe's
// captured `preview` (lib/plotRecipePreview.ts): normalized [0, 1] polylines,
// one per captured series, in the theme's series colours. Numbers in, JSX
// out -- the preview is sanitized to finite numbers at every read boundary
// (lib/plotRecipeMigrate.ts's `sanitizePreview`), and nothing here builds
// markup from strings, so an imported recipe cannot inject into the page.
//
// Q6: an optional `glyph` (`previewGlyph`, same module) overlays a v3
// recipe's multi-panel grid as thin cell dividers and marks a recorded map
// view with a small corner swatch; both are also named in the aria-label.
//
// A recipe with no preview and no grid (a built-in, one migrated from v1, or
// one saved from a plot with nothing drawable) shows an empty dashed frame
// labelled "no preview", never a made-up curve.

import type { PreviewGlyph } from "../../../lib/plotRecipePreview";
import type { RecipePreview } from "../../../lib/plotRecipeSchema";

const W = 64;
const H = 36;
const PAD = 3;

/** Inner cell dividers for a rows x cols grid: rows-1 horizontal, cols-1 vertical. */
function gridLines({ rows, cols }: { rows: number; cols: number }) {
  const h = Array.from({ length: rows - 1 }, (_, i) => (H * (i + 1)) / rows);
  const v = Array.from({ length: cols - 1 }, (_, i) => (W * (i + 1)) / cols);
  return [
    ...h.map((y) => <line key={`h${y}`} data-grid x1={0} x2={W} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />),
    ...v.map((x) => <line key={`v${x}`} data-grid x1={x} x2={x} y1={0} y2={H} stroke="var(--border)" strokeWidth={1} />),
  ];
}

export function RecipeThumbnail({
  preview,
  label,
  summary,
  glyph,
}: {
  preview: RecipePreview | null;
  label: string;
  summary?: string;
  glyph?: PreviewGlyph;
}) {
  const grid = glyph?.grid ?? null;
  if (!preview && !grid) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: no preview`} style={{ flexShrink: 0 }}>
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={3} fill="none" stroke="var(--border)" strokeDasharray="3 2" />
        <title>No preview was saved with this recipe.</title>
      </svg>
    );
  }
  const px = (x: number): number => PAD + x * (W - 2 * PAD);
  const py = (y: number): number => H - PAD - y * (H - 2 * PAD);
  const parts = [preview ? "preview" : null, grid ? `${grid.rows}×${grid.cols} panels` : null, glyph?.map ? "map view" : null];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${parts.filter(Boolean).join(", ")}`} style={{ flexShrink: 0 }}>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={3} fill="var(--surface-1)" stroke="var(--border)" />
      {summary && <title>{summary}</title>}
      {grid && gridLines(grid)}
      {preview?.series.map((pts, i) => (
        <polyline
          key={i}
          points={pts.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={`var(--series-${(i % 8) + 1})`}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ))}
      {glyph?.map && <rect data-map x={W - 10} y={2} width={8} height={8} rx={1.5} fill="var(--accent)" />}
    </svg>
  );
}

export default RecipeThumbnail;
