// The parameter fields of the "signal extras" sigop methods (sigopExtrasModel.ts).
// Pure view over `SigopForm`, rendered by SigopFields.

import type { Dataset } from "../../../lib/types";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import type { SigopExtraMethod } from "./sigopExtrasModel";
import type { SigopForm } from "./sigopModel";

interface Props {
  method: SigopExtraMethod;
  form: SigopForm;
  set: (patch: Partial<SigopForm>) => void;
  dataset: Dataset;
  xUnit: string;
}

const WINDOWS = [
  { value: "hanning", label: "Hann" },
  { value: "hamming", label: "Hamming" },
  { value: "blackman", label: "Blackman" },
  { value: "flattop", label: "Flat top" },
  { value: "none", label: "None (rectangular)" },
];

function Field({ label, value, onChange, min, step }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  step?: number | "any";
}) {
  return (
    <label>{label}
      <NumberField aria-label={label} min={min} step={step} value={value} onChange={onChange} />
    </label>
  );
}

/** Nyquist frequency of the worksheet's X (median spacing), or null when X has no usable spacing. */
export function nyquistOf(time: ArrayLike<number>): number | null {
  const steps: number[] = [];
  for (let i = 1; i < time.length; i++) {
    const d = Math.abs(time[i] - time[i - 1]);
    if (Number.isFinite(d) && d > 0) steps.push(d);
  }
  if (steps.length === 0) return null;
  steps.sort((a, b) => a - b);
  return 0.5 / steps[Math.floor(steps.length / 2)];
}

export default function SigopExtraFields({ method, form, set, dataset, xUnit }: Props) {
  const per = xUnit ? ` (1/${xUnit})` : "";
  switch (method) {
    case "unwrap":
      return (
        <>
          <label>Phase is in
            <Select aria-label="Phase is in" value={form.phaseUnit} options={[{ value: "radians", label: "Radians" }, { value: "degrees", label: "Degrees" }]} onChange={(e) => set({ phaseUnit: e.target.value as SigopForm["phaseUnit"] })} />
          </label>
          <p className="qz-muted">Removes jumps of 2π (or 360°) between neighbouring rows, in row order. Blank rows stay blank.</p>
        </>
      );
    case "percentile":
      return (
        <>
          <Field label="Window (odd, rows)" min={1} step={2} value={form.window} onChange={(window) => set({ window })} />
          <Field label="Percentile (0 min · 50 median · 100 max)" min={0} step="any" value={form.percentile} onChange={(percentile) => set({ percentile })} />
        </>
      );
    case "binomial":
      return (
        <>
          <Field label="Window (odd, rows)" min={1} step={2} value={form.window} onChange={(window) => set({ window })} />
          <p className="qz-muted">Weights are binomial coefficients (a discrete Gaussian); a wider window smooths more.</p>
        </>
      );
    case "envelope-extrema":
      return (
        <>
          <label>Envelope
            <Select aria-label="Envelope" value={form.envSide} options={[{ value: "both", label: "Upper and lower" }, { value: "upper", label: "Upper (maxima)" }, { value: "lower", label: "Lower (minima)" }]} onChange={(e) => set({ envSide: e.target.value as SigopForm["envSide"] })} />
          </label>
          <label>Interpolation
            <Select aria-label="Interpolation" value={form.envInterpolation} options={[{ value: "spline", label: "Cubic spline" }, { value: "linear", label: "Linear" }]} onChange={(e) => set({ envInterpolation: e.target.value as SigopForm["envInterpolation"] })} />
          </label>
          <Field label="Minimum distance between extrema (rows)" min={1} step={1} value={form.envMinDistance} onChange={(envMinDistance) => set({ envMinDistance })} />
          <p className="qz-muted">Curve through the local maxima / minima; needs an increasing X. Raise the distance to skip noise ripples.</p>
        </>
      );
    case "coherence":
      return (
        <>
          <label>Window
            <Select aria-label="Window" value={form.spectralWindow} options={WINDOWS} onChange={(e) => set({ spectralWindow: e.target.value as SigopForm["spectralWindow"] })} />
          </label>
          <Field label="Segment length (rows)" min={4} step={1} value={form.segmentLen} onChange={(segmentLen) => set({ segmentLen })} />
          <Field label="Overlap (fraction, 0 to <1)" min={0} step="any" value={form.overlap} onChange={(overlap) => set({ overlap })} />
          <p className="qz-muted">Tick exactly two signal columns. Magnitude-squared coherence by Welch averaging, 0 to 1 against frequency; needs a uniform X. Many segments are needed for a trustworthy value near 0.</p>
        </>
      );
    case "decimate-aa":
      return (
        <>
          <Field label="Decimation factor" min={2} step={1} value={form.factor} onChange={(factor) => set({ factor })} />
          <label>Anti-alias filter
            <Select aria-label="Anti-alias filter" value={form.aaFilter} options={[{ value: "iir", label: "IIR (Chebyshev, up to ×13)" }, { value: "fir", label: "FIR (Hamming window)" }]} onChange={(e) => set({ aaFilter: e.target.value as SigopForm["aaFilter"] })} />
          </label>
          <Field label="Filter order (blank = default)" min={1} step={1} value={form.aaOrder} onChange={(aaOrder) => set({ aaOrder })} />
          <Checkbox checked={form.zeroPhase} onChange={(zeroPhase) => set({ zeroPhase })}>Zero-phase (no shift)</Checkbox>
          <p className="qz-muted">Low-passes below the new Nyquist rate, then keeps every Nth row, so fast content cannot alias. Differs from “Keep every Nth row”, which does not filter. Needs a uniform X and no blank rows.</p>
        </>
      );
    case "zoom-fft": {
      const nyquist = nyquistOf(dataset.data.time);
      return (
        <>
          <Field label={`Band start${per}`} min={0} step="any" value={form.fMin} onChange={(fMin) => set({ fMin })} />
          <Field label={`Band end${per}`} min={0} step="any" value={form.fMax} onChange={(fMax) => set({ fMax })} />
          <Field label="Points across the band" min={2} step={1} value={form.nPoints} onChange={(nPoints) => set({ nPoints })} />
          <label>Window
            <Select aria-label="Window" value={form.spectralWindow} options={WINDOWS} onChange={(e) => set({ spectralWindow: e.target.value as SigopForm["spectralWindow"] })} />
          </label>
          <Checkbox checked={form.removeMean} onChange={(removeMean) => set({ removeMean })}>Remove the mean first</Checkbox>
          <p className="qz-muted">
            Amplitude spectrum sampled finely on a band (chirp-z). It shows peaks a plain FFT samples too coarsely; resolution is still set by the record length.
            {nyquist !== null && ` Highest usable frequency here: ${nyquist.toPrecision(4)}.`}
          </p>
        </>
      );
    }
  }
}
