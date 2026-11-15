// The parameter fields of one signal filter / Reduce XY method. Pure view over
// `SigopForm` (sigopModel.ts), shared by the Signal Processing and Resample
// workshops.

import type { Dataset } from "../../../lib/types";
import type { SigopMethod } from "../../../lib/transformSigop";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import type { SigopForm } from "./sigopModel";

interface Props {
  method: SigopMethod;
  form: SigopForm;
  set: (patch: Partial<SigopForm>) => void;
  dataset: Dataset;
  xUnit: string;
}

const STAT = [{ value: "mean", label: "Mean" }, { value: "median", label: "Median" }];

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

function ReduceStats({ form, set }: Pick<Props, "form" | "set">) {
  return (
    <>
      <label>Average
        <Select aria-label="Average" value={form.stat} options={STAT} onChange={(e) => set({ stat: e.target.value as SigopForm["stat"] })} />
      </label>
      <Checkbox checked={form.withSd} onChange={(withSd) => set({ withSd })}>Add a standard-deviation column per channel</Checkbox>
      <Checkbox checked={form.withCount} onChange={(withCount) => set({ withCount })}>Add a point-count column</Checkbox>
    </>
  );
}

export default function SigopFields({ method, form, set, dataset, xUnit }: Props) {
  const unit = xUnit ? ` (${xUnit})` : "";
  switch (method) {
    case "median":
      return <Field label="Window (odd, rows)" min={1} step={2} value={form.window} onChange={(window) => set({ window })} />;
    case "despike":
      return (
        <>
          <Field label="Window (odd, rows)" min={3} step={2} value={form.window} onChange={(window) => set({ window })} />
          <Field label="Threshold (× MAD)" min={1} step="any" value={form.threshold} onChange={(threshold) => set({ threshold })} />
          <p className="qz-muted">Flagged points are marked in the preview and replaced by interpolation.</p>
        </>
      );
    case "lowess":
      return (
        <>
          <Field label="Fraction of points per fit" min={0.01} step="any" value={form.fraction} onChange={(fraction) => set({ fraction })} />
          <Field label="Robust iterations" min={0} step={1} value={form.iterations} onChange={(iterations) => set({ iterations })} />
        </>
      );
    case "convolve":
    case "deconvolve":
      return (
        <>
          <label>Kernel
            <Select aria-label="Kernel" value={form.kernel} options={[{ value: "gaussian", label: "Gaussian" }, { value: "lorentzian", label: "Lorentzian" }]} onChange={(e) => set({ kernel: e.target.value as SigopForm["kernel"] })} />
          </label>
          <Field label={`Width (FWHM)${unit}`} min={0} step="any" value={form.fwhm} onChange={(fwhm) => set({ fwhm })} />
          {method === "deconvolve" && <Field label="Regularisation (noise / signal)" min={0} step="any" value={form.regularisation} onChange={(regularisation) => set({ regularisation })} />}
          <p className="qz-muted">Needs a uniform, monotonic X; resample first if the steps differ.</p>
        </>
      );
    case "hilbert":
      return (
        <>
          <label>Output
            <Select aria-label="Output" value={form.output} options={[{ value: "envelope", label: "Amplitude envelope" }, { value: "hilbert", label: "Hilbert transform" }]} onChange={(e) => set({ output: e.target.value as SigopForm["output"] })} />
          </label>
          <Checkbox checked={form.removeMean} onChange={(removeMean) => set({ removeMean })}>Remove the mean first</Checkbox>
        </>
      );
    case "ifft": {
      const options = dataset.data.labels.map((l, i) => ({ value: String(i), label: l || `column ${i + 1}` }));
      return (
        <>
          <label>Magnitude column
            <Select aria-label="Magnitude column" value={String(form.magnitudeChannel)} options={options} onChange={(e) => set({ magnitudeChannel: Number(e.target.value) })} />
          </label>
          <label>Phase column (degrees)
            <Select aria-label="Phase column" value={String(form.phaseChannel)} options={options} onChange={(e) => set({ phaseChannel: Number(e.target.value) })} />
          </label>
          <p className="qz-muted">Run the FFT with Window = none (once for Magnitude, once for Phase) and join the two spectra on Frequency. Edit the magnitude column (zero a band, notch a line), then invert it.</p>
        </>
      );
    }
    case "reduce-bin":
      return (
        <>
          <label>Bins by
            <Select aria-label="Bins by" value={form.binMode} options={[{ value: "count", label: "Number of bins" }, { value: "width", label: "Bin width" }]} onChange={(e) => set({ binMode: e.target.value as SigopForm["binMode"] })} />
          </label>
          {form.binMode === "count"
            ? <Field label="Number of bins" min={1} step={1} value={form.nBins} onChange={(nBins) => set({ nBins })} />
            : <Field label={`Bin width${unit}`} min={0} step="any" value={form.binWidth} onChange={(binWidth) => set({ binWidth })} />}
          <label>Row X is
            <Select aria-label="Row X is" value={form.xMode} options={[{ value: "mean", label: "Mean X of the bin's points" }, { value: "center", label: "Bin centre" }]} onChange={(e) => set({ xMode: e.target.value as SigopForm["xMode"] })} />
          </label>
          <ReduceStats form={form} set={set} />
        </>
      );
    case "reduce-duplicates":
      return (
        <>
          <Field label={`Treat X within${unit} as equal`} min={0} step="any" value={form.tolerance} onChange={(tolerance) => set({ tolerance })} />
          <ReduceStats form={form} set={set} />
        </>
      );
    case "reduce-nth":
      return (
        <>
          <Field label="Keep every Nth row" min={1} step={1} value={form.n} onChange={(n) => set({ n })} />
          <Field label="Starting at row (0 = first)" min={0} step={1} value={form.offset} onChange={(offset) => set({ offset })} />
          <p className="qz-muted">Works in any row order (loops included); every column is kept.</p>
        </>
      );
  }
}
