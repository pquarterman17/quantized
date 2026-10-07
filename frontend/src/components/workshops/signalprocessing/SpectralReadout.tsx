import type { DataStruct } from "../../../lib/types";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function diagnosticPoints(metadata: DataStruct["metadata"]): string {
  const raw = metadata.filterDiagnostics;
  if (!raw || typeof raw !== "object") return "";
  const diagnostics = raw as Record<string, unknown>;
  const frequency = Array.isArray(diagnostics.frequency) ? diagnostics.frequency : [];
  const transfer = Array.isArray(diagnostics.transfer) ? diagnostics.transfer : [];
  const rows = frequency.flatMap((x, index): [number, number][] =>
    finite(x) && finite(transfer[index]) ? [[x, transfer[index] as number]] : []);
  if (rows.length < 2) return "";
  const xmax = Math.max(...rows.map(([x]) => x)) || 1;
  return rows.map(([x, y]) => {
    const px = 8 + (x / xmax) * 444;
    const py = 8 + (1 - Math.max(0, Math.min(1, y))) * 54;
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(" ");
}

function numberText(value: number): string {
  return Math.abs(value) >= 1e4 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)
    ? value.toExponential(4)
    : value.toPrecision(5).replace(/\.?0+$/, "");
}

export default function SpectralReadout({ result }: { result: DataStruct | null }) {
  if (!result) return null;
  const points = diagnosticPoints(result.metadata);
  const peakLag = result.metadata.peakLag;
  const peakCorrelation = result.metadata.peakCorrelation;
  const xUnit = typeof result.metadata.x_column_unit === "string"
    ? result.metadata.x_column_unit
    : "";
  return (
    <>
      {points && (
        <div className="qz-spectral-response">
          <span>Filter transfer function</span>
          <svg viewBox="0 0 460 70" role="img" aria-label="Filter transfer function preview">
            <rect x="0" y="0" width="460" height="70" fill="var(--bg-1)" />
            <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
          </svg>
        </div>
      )}
      {finite(peakLag) && finite(peakCorrelation) && (
        <div className="qz-spectral-metrics" aria-label="Cross-correlation peak">
          <span>Peak lag <strong>{numberText(peakLag)}{xUnit ? ` ${xUnit}` : ""}</strong></span>
          <span>Correlation <strong>{numberText(peakCorrelation)}</strong></span>
        </div>
      )}
    </>
  );
}
