import type { DataStruct } from "../../../lib/types";

interface Response {
  frequency: number[];
  magnitudeDb: number[];
  phaseDeg: number[];
  zeroPhase: boolean;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numbers = (value: unknown): number[] | null =>
  Array.isArray(value) && value.length >= 2 && value.every(finite) ? value as number[] : null;

/** The backend's `metadata.iirResponse`, or null when absent or malformed. */
export function iirResponseOf(metadata: DataStruct["metadata"]): Response | null {
  const raw = metadata.iirResponse;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const frequency = numbers(r.frequency);
  const magnitudeDb = numbers(r.magnitudeDb);
  const phaseDeg = numbers(r.phaseDeg);
  if (!frequency || !magnitudeDb || !phaseDeg) return null;
  if (frequency.length !== magnitudeDb.length || frequency.length !== phaseDeg.length) return null;
  return { frequency, magnitudeDb, phaseDeg, zeroPhase: r.zeroPhase === true };
}

function trace(x: number[], y: number[], lo: number, hi: number): string {
  const xmax = x[x.length - 1] || 1;
  return x.map((v, i) => {
    const t = (Math.max(lo, Math.min(hi, y[i])) - lo) / (hi - lo || 1);
    return `${(8 + (v / xmax) * 444).toFixed(1)},${(8 + (1 - t) * 54).toFixed(1)}`;
  }).join(" ");
}

/** Magnitude (dB) and phase (degrees) of the designed IIR filter, 0 to Nyquist. */
export default function IirResponsePreview({ response, unit }: { response: Response; unit: string }) {
  const lo = Math.max(-100, Math.min(-6, ...response.magnitudeDb));
  const hi = Math.max(3, ...response.magnitudeDb);
  const pMin = Math.min(0, ...response.phaseDeg);
  const pMax = Math.max(1, ...response.phaseDeg);
  const label = response.zeroPhase ? "applied (zero-phase: |H|², no phase)" : "causal";
  return (
    <div className="qz-spectral-response" data-testid="iir-response">
      <span>Frequency response · {label}</span>
      <svg viewBox="0 0 460 70" role="img" aria-label="IIR magnitude response">
        <rect x="0" y="0" width="460" height="70" fill="var(--bg-1)" />
        <polyline points={trace(response.frequency, response.magnitudeDb, lo, hi)} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      </svg>
      <span>Magnitude {lo.toFixed(0)} to {hi.toFixed(0)} dB, 0 to {response.frequency[response.frequency.length - 1].toPrecision(4)}{unit ? ` ${unit}` : ""}</span>
      <svg viewBox="0 0 460 70" role="img" aria-label="IIR phase response">
        <rect x="0" y="0" width="460" height="70" fill="var(--bg-1)" />
        <polyline points={trace(response.frequency, response.phaseDeg, pMin, pMax)} fill="none" stroke="var(--series-2, var(--accent))" strokeWidth="1.8" />
      </svg>
      <span>Phase {pMin.toFixed(0)} to {pMax.toFixed(0)} deg</span>
    </div>
  );
}
