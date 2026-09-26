// Resample / align workshop — the live overlay: the source channel as a line,
// the resampled points as markers on top (a line when there are too many to
// mark). A dependency-free SVG, so the lazy workshop chunk stays small; the
// point is to SEE where the new grid lands, blanks and all, before creating.

import type { DataStruct } from "../../../lib/types";

const W = 300;
const H = 140;
const PAD = 6;
/** Above this many resampled points, draw a line instead of markers. */
const MAX_MARKERS = 300;

type Pt = [number, number];

function pairs(d: DataStruct, channel: number): Pt[] {
  const out: Pt[] = [];
  d.time.forEach((x, i) => {
    const y = d.values[i]?.[channel];
    if (Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) out.push([x, y]);
  });
  return out;
}

/** [min, max] by loop (a spread would overflow the stack on a long column). */
function extent(values: Iterable<number>): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  return [lo, hi];
}

export default function ResamplePreviewPlot({
  source,
  result,
  channel,
}: {
  source: DataStruct;
  result: DataStruct;
  channel: number;
}) {
  const src = pairs(source, channel);
  const out = pairs(result, channel);
  const all = [...src, ...out];
  if (!all.length) {
    return <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>Nothing to plot in this column.</div>;
  }
  // x spans the resampled grid too, so blank (out-of-range) targets still
  // widen the axis and the gap they leave is visible.
  const [x0, x1] = extent([...all.map((p) => p[0]), ...result.time]);
  const [y0, y1] = extent(all.map((p) => p[1]));
  const sx = (x: number) => PAD + ((x - x0) / (x1 - x0)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - y0) / (y1 - y0)) * (H - 2 * PAD);
  const path = (pts: Pt[]) => pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");

  return (
    <svg
      role="img"
      aria-label={`Preview: ${src.length} source points, ${out.length} resampled points`}
      data-testid="resample-preview-plot"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: "block", background: "var(--surface-sunken, var(--bg))", borderRadius: 4, marginTop: 6 }}
    >
      <polyline points={path(src)} fill="none" stroke="var(--series-1)" strokeWidth={1.2} opacity={0.7} />
      {out.length > MAX_MARKERS ? (
        <polyline points={path(out)} fill="none" stroke="var(--series-2)" strokeWidth={1.2} strokeDasharray="3 2" />
      ) : (
        out.map(([x, y], i) => (
          <circle key={i} cx={sx(x)} cy={sy(y)} r={1.8} fill="var(--series-2)" data-resampled-point="" />
        ))
      )}
    </svg>
  );
}
