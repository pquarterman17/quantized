// Plot Recipe preview thumbnail (F4.2 / audit P1.3). Draws a recipe's
// captured `preview` (lib/plotRecipePreview.ts): normalized [0, 1] polylines,
// one per captured series, in the theme's series colours. Numbers in, JSX
// out -- the preview is sanitized to finite numbers at every read boundary
// (lib/plotRecipeMigrate.ts's `sanitizePreview`), and nothing here builds
// markup from strings, so an imported recipe cannot inject into the page.
//
// A recipe with no preview (a built-in, one migrated from v1, or one saved
// from a plot with nothing drawable) shows an empty dashed frame labelled
// "no preview", never a made-up curve.

import type { RecipePreview } from "../../../lib/plotRecipeSchema";

const W = 64;
const H = 36;
const PAD = 3;

export function RecipeThumbnail({ preview, label, summary }: { preview: RecipePreview | null; label: string; summary?: string }) {
  if (!preview) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: no preview`} style={{ flexShrink: 0 }}>
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={3} fill="none" stroke="var(--border)" strokeDasharray="3 2" />
        <title>No preview was saved with this recipe.</title>
      </svg>
    );
  }
  const px = (x: number): number => PAD + x * (W - 2 * PAD);
  const py = (y: number): number => H - PAD - y * (H - 2 * PAD);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: preview`} style={{ flexShrink: 0 }}>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={3} fill="var(--surface-1)" stroke="var(--border)" />
      {summary && <title>{summary}</title>}
      {preview.series.map((pts, i) => (
        <polyline
          key={i}
          points={pts.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={`var(--series-${(i % 8) + 1})`}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export default RecipeThumbnail;
