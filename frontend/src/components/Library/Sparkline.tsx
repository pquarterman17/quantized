// Tiny inline-SVG sparkline of a dataset's primary y-channel. No deps.

import { useMemo } from "react";

import { columnMetaList } from "../../lib/columnmeta";
import { downsampleMinMax, trimTrailingPadding } from "../../lib/downsample";
import { primaryChannel } from "../../lib/plotdata";
import type { DataStruct } from "../../lib/types";

const W = 180;
const H = 26;
// ~2x the thumbnail's pixel width: enough resolution that a bucket never
// spans more than half a pixel, so downsampling is visually lossless while
// capping the SVG path at a couple hundred points instead of tens of
// thousands (Library.tsx mounts one of these per row, up to ~120+ at once).
const MAX_BUCKETS = W * 2;

/** The value channel a one-line preview should draw. An Origin book's `.time`
 *  is already the designated X column (io/origin_project/opj.py promotes it
 *  out of `.values`), so every remaining value channel is Y/Y-error/X-error/
 *  Label — the density heuristic behind `primaryChannel` can't tell those
 *  apart (an X-error or Y-error column reads just as "dense" as the real Y
 *  data) and may pick an error column instead of the curve itself (PNR
 *  Book15: channel 0 is `dQ`, an X-error column). Prefer the first channel
 *  Origin explicitly designated "Y"; fall back to `primaryChannel`'s density
 *  heuristic for non-Origin data (no designations at all). */
function pickChannel(data: DataStruct): number {
  const meta = columnMetaList(data);
  const firstY = meta.findIndex((m) => m?.designation === "Y");
  if (firstY >= 0) return firstY;
  return primaryChannel(data) ?? 0;
}

export default function Sparkline({ data }: { data: DataStruct }) {
  const path = useMemo(() => {
    const ch = pickChannel(data);
    const ys = data.values.map((row) => row[ch]);
    const xs = data.time;
    const nRaw = Math.min(xs.length, ys.length);
    // Drop a trailing "allocated but unfilled" padding run (Origin's
    // over-allocated worksheet storage — see lib/downsample.trimTrailingPadding)
    // BEFORE downsampling: left in, it resets x back toward 0 at the tail and
    // collapses the sparkline toward the origin instead of tracing the real
    // curve. Reducing `n` is enough — the padding is always a tail run, so
    // downsampleMinMax below simply never looks past it.
    const n = trimTrailingPadding(xs, ys, nRaw);
    if (n < 2) return "";
    // Downsample BEFORE path-building (min/max-per-bucket, never plain
    // stride — a stride sample can step clean over a spike): the same pass
    // that picks each bucket's extremes also tracks the exact global x/y
    // bounds, so there's no separate full-resolution bounds pass either.
    const { xs: dxs, ys: dys, xMin, xMax, yMin, yMax } = downsampleMinMax(xs, ys, n, MAX_BUCKETS);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    // Sort the sampled points by x before building the path: a thumbnail has
    // no hysteresis-fidelity requirement (unlike the main plot), so a
    // non-ascending x (an unsorted Origin X column, or a loop-shaped dataset)
    // should read as a clean monotonic silhouette rather than a scribble.
    const order = dxs.map((_, i) => i).sort((a, b) => dxs[a] - dxs[b]);
    const pts: string[] = [];
    for (const i of order) {
      const px = ((dxs[i] - xMin) / xSpan) * (W - 2) + 1;
      const py = H - 1 - ((dys[i] - yMin) / ySpan) * (H - 2);
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    return "M" + pts.join(" L");
  }, [data]);

  return (
    <svg className="qzk-ds-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={1} />
    </svg>
  );
}
