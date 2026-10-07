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

function points(
  rows: (readonly [number, number])[],
  bounds: readonly [number, number, number, number],
  width: number,
  height: number,
): string {
  const [xmin, xmax, ymin, ymax] = bounds;
  const xspan = xmax - xmin || 1;
  const yspan = ymax - ymin || 1;
  return rows.map(([x, y]) => {
    const px = 8 + ((x - xmin) / xspan) * (width - 16);
    const py = 8 + (1 - (y - ymin) / yspan) * (height - 16);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(" ");
}

export default function SignalPreview({
  source,
  result,
  channel,
  resultChannel = channel,
  showOriginal = true,
}: {
  source: DataStruct;
  result: DataStruct | null;
  channel: number;
  resultChannel?: number;
  showOriginal?: boolean;
}) {
  const width = 460;
  const height = 150;
  const originalRows = showOriginal ? samplePreviewRows(finiteRows(source, channel)) : [];
  const processedRows = result ? samplePreviewRows(finiteRows(result, resultChannel)) : [];
  const combined = [...originalRows, ...processedRows];
  const bounds = combined.length
    ? [
        Math.min(...combined.map(([x]) => x)),
        Math.max(...combined.map(([x]) => x)),
        Math.min(...combined.map(([, y]) => y)),
        Math.max(...combined.map(([, y]) => y)),
      ] as const
    : [0, 1, 0, 1] as const;
  return (
    <div className="qz-signal-preview">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={showOriginal ? "Original and processed signal preview" : "Analysis output preview"}>
        <rect x="0" y="0" width={width} height={height} fill="var(--bg-1)" />
        <polyline points={points(originalRows, bounds, width, height)} fill="none" stroke="var(--text-faint)" strokeWidth="1.2" />
        {result && <polyline points={points(processedRows, bounds, width, height)} fill="none" stroke="var(--accent)" strokeWidth="1.8" />}
      </svg>
      <div className="qz-signal-preview-key">
        <span className="qz-signal-preview-name">Preview: {result?.labels[resultChannel] ?? source.labels[channel] ?? `channel ${channel + 1}`}</span>
        {showOriginal && <span>Original</span>}<strong>{showOriginal ? "Processed" : "Output"}</strong>
      </div>
    </div>
  );
}
