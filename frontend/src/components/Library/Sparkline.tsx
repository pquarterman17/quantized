// Tiny inline-SVG sparkline of a dataset's primary y-channel. No deps.

import { useMemo } from "react";

import { downsampleMinMax } from "../../lib/downsample";
import { primaryChannel } from "../../lib/plotdata";
import type { DataStruct } from "../../lib/types";

const W = 180;
const H = 26;
// ~2x the thumbnail's pixel width: enough resolution that a bucket never
// spans more than half a pixel, so downsampling is visually lossless while
// capping the SVG path at a couple hundred points instead of tens of
// thousands (Library.tsx mounts one of these per row, up to ~120+ at once).
const MAX_BUCKETS = W * 2;

export default function Sparkline({ data }: { data: DataStruct }) {
  const path = useMemo(() => {
    // Not hardcoded to channel 0: a NaN-sparse dataset (e.g. Quantum Design
    // magnetometry, where unrelated measurement types populate different
    // columns) may carry its real data on a later channel — primaryChannel
    // picks the same dense channel the main plot draws by default, so the
    // thumbnail always matches what the plot shows.
    const ch = primaryChannel(data) ?? 0;
    const ys = data.values.map((row) => row[ch]);
    const xs = data.time;
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return "";
    // Downsample BEFORE path-building (min/max-per-bucket, never plain
    // stride — a stride sample can step clean over a spike): the same pass
    // that picks each bucket's extremes also tracks the exact global x/y
    // bounds, so there's no separate full-resolution bounds pass either.
    const { xs: dxs, ys: dys, xMin, xMax, yMin, yMax } = downsampleMinMax(xs, ys, n, MAX_BUCKETS);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const pts: string[] = [];
    for (let i = 0; i < dxs.length; i++) {
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
