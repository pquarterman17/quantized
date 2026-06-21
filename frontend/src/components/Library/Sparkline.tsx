// Tiny inline-SVG sparkline of a dataset's first y-channel. No deps.

import { useMemo } from "react";

import type { DataStruct } from "../../lib/types";

const W = 180;
const H = 26;

export default function Sparkline({ data }: { data: DataStruct }) {
  const path = useMemo(() => {
    const ys = data.values.map((row) => row[0]);
    const xs = data.time;
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return "";
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const px = ((x - xMin) / xSpan) * (W - 2) + 1;
      const py = H - 1 - ((y - yMin) / ySpan) * (H - 2);
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
