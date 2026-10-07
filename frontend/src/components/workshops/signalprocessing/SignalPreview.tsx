import type { DataStruct } from "../../../lib/types";

function finiteRows(data: DataStruct, channel: number): (readonly [number, number])[] {
  return data.time
    .map((x, row) => [x, data.values[row]?.[channel]] as const)
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function sample(rows: (readonly [number, number])[]): (readonly [number, number])[] {
  const stride = Math.max(1, Math.ceil(rows.length / 400));
  return rows.filter((_, index) => index % stride === 0 || index === rows.length - 1);
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
}: {
  source: DataStruct;
  result: DataStruct | null;
  channel: number;
}) {
  const width = 460;
  const height = 150;
  const originalRows = sample(finiteRows(source, channel));
  const processedRows = result ? sample(finiteRows(result, channel)) : [];
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
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Original and processed signal preview">
        <rect x="0" y="0" width={width} height={height} fill="var(--bg-1)" />
        <polyline points={points(originalRows, bounds, width, height)} fill="none" stroke="var(--text-faint)" strokeWidth="1.2" />
        {result && <polyline points={points(processedRows, bounds, width, height)} fill="none" stroke="var(--accent)" strokeWidth="1.8" />}
      </svg>
      <div className="qz-signal-preview-key">
        <span className="qz-signal-preview-name">Preview: {source.labels[channel] ?? `channel ${channel + 1}`}</span>
        <span>Original</span><strong>Processed</strong>
      </div>
    </div>
  );
}
