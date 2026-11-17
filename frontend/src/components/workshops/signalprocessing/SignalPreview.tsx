import type { DataStruct } from "../../../lib/types";

function finiteRows(data: DataStruct, channel: number): (readonly [number, number])[] {
  return data.time
    .map((x, row) => [x, data.values[row]?.[channel]] as const)
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

export function samplePreviewRows(
  rows: (readonly [number, number])[],
  maxPoints = 400,
): (readonly [number, number])[] {
  if (rows.length <= maxPoints) return rows;
  // Keep the local high and low point from each bucket. Uniform every-Nth
  // sampling can erase a narrow diffraction/spectroscopy peak completely,
  // making the smoothing preview scientifically misleading.
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const bucketSize = Math.ceil((rows.length - 2) / bucketCount);
  const sampled: (readonly [number, number])[] = [rows[0]];
  for (let start = 1; start < rows.length - 1; start += bucketSize) {
    const end = Math.min(rows.length - 1, start + bucketSize);
    let low = start;
    let high = start;
    for (let index = start + 1; index < end; index += 1) {
      if (rows[index][1] < rows[low][1]) low = index;
      if (rows[index][1] > rows[high][1]) high = index;
    }
    sampled.push(rows[Math.min(low, high)]);
    if (low !== high) sampled.push(rows[Math.max(low, high)]);
  }
  sampled.push(rows[rows.length - 1]);
  return sampled;
}

type Bounds = readonly [number, number, number, number];

function boundsOf(rows: readonly (readonly [number, number])[]): Bounds {
  if (!rows.length) return [0, 1, 0, 1];
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const [x, y] of rows) {
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  return [xmin, xmax, ymin, ymax];
}

/** Pixel position inside a pane `height` tall whose top edge sits at `top`. */
function project(x: number, y: number, b: Bounds, width: number, height: number, top: number): [number, number] {
  const [xmin, xmax, ymin, ymax] = b;
  return [
    8 + ((x - xmin) / (xmax - xmin || 1)) * (width - 16),
    top + 8 + (1 - (y - ymin) / (ymax - ymin || 1)) * (height - 16),
  ];
}

function points(rows: (readonly [number, number])[], b: Bounds, width: number, height: number, top = 0): string {
  return rows.map(([x, y]) => {
    const [px, py] = project(x, y, b, width, height, top);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(" ");
}

/** Processed gets its OWN Y scale (stacked pane) when its span is under half
 *  (or over double) the original's: a normalised or differentiated curve on the
 *  original's scale is a flat line. Comparable spans keep the one-scale overlay
 *  so smoothing/baseline stay directly comparable. */
function needsOwnScale(a: Bounds, b: Bounds): boolean {
  const sa = a[3] - a[2];
  const sb = b[3] - b[2];
  if (!(sa > 0) || !(sb > 0)) return false;
  const ratio = sa < sb ? sa / sb : sb / sa;
  return ratio < 0.5;
}

export default function SignalPreview({
  source,
  result,
  channel,
  resultChannel = channel,
  showOriginal = true,
  flagged = [],
}: {
  source: DataStruct;
  result: DataStruct | null;
  channel: number;
  resultChannel?: number;
  showOriginal?: boolean;
  /** Despike: the points about to be replaced, marked on the original trace. */
  flagged?: readonly (readonly [number, number])[];
}) {
  const width = 460;
  const originalRows = showOriginal ? samplePreviewRows(finiteRows(source, channel)) : [];
  const processedRows = result ? samplePreviewRows(finiteRows(result, resultChannel)) : [];
  const origBounds = boundsOf([...originalRows, ...flagged]);
  const procBounds = boundsOf(processedRows);
  const stacked = originalRows.length > 0 && processedRows.length > 0 && needsOwnScale(origBounds, procBounds);
  const paneH = stacked ? 110 : 150;
  const height = stacked ? 2 * paneH + 6 : 150;
  const shared: Bounds = boundsOf([...originalRows, ...processedRows, ...flagged]);
  const xs = shared;
  const ob: Bounds = stacked ? [xs[0], xs[1], origBounds[2], origBounds[3]] : shared;
  const pb: Bounds = stacked ? [xs[0], xs[1], procBounds[2], procBounds[3]] : shared;
  const procTop = stacked ? paneH + 6 : 0;
  return (
    <div className="qz-signal-preview">
      <svg viewBox={`0 0 ${width} ${height}`} style={stacked ? { height: `${height}px` } : undefined} role="img" data-layout={stacked ? "stacked" : "overlay"} aria-label={showOriginal ? "Original and processed signal preview" : "Analysis output preview"}>
        <rect x="0" y="0" width={width} height={height} fill="var(--bg-1)" />
        <polyline points={points(originalRows, ob, width, paneH)} fill="none" stroke="var(--text-faint)" strokeWidth="1.2" />
        {flagged.slice(0, 200).map(([x, y]) => {
          const [cx, cy] = project(x, y, ob, width, paneH, 0);
          return <circle key={`${x}:${y}`} cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="3" fill="none" stroke="var(--danger)" strokeWidth="1.4" data-flagged="" />;
        })}
        {stacked && <line x1="0" x2={width} y1={paneH + 3} y2={paneH + 3} stroke="var(--border)" strokeWidth="1" />}
        {result && <polyline points={points(processedRows, pb, width, paneH, procTop)} fill="none" stroke="var(--accent)" strokeWidth="1.8" />}
      </svg>
      <div className="qz-signal-preview-key">
        <span className="qz-signal-preview-name">Preview: {result?.labels[resultChannel] ?? source.labels[channel] ?? `channel ${channel + 1}`}</span>
        {showOriginal && <span>Original</span>}<strong>{showOriginal ? "Processed" : "Output"}</strong>
        {stacked && <span>own Y scale</span>}
      </div>
    </div>
  );
}
