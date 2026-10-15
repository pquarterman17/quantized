import { Select } from "../../primitives";
import type { SignalOperation } from "./signalProcessingModel";

const OPTIONS: { value: SignalOperation; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "normalize-range", label: "Normalize · 0–1" },
  { value: "normalize-peak", label: "Normalize · peak = 1" },
  { value: "normalize-zscore", label: "Normalize · Z-score" },
  { value: "normalize-area", label: "Normalize · area = 1" },
  { value: "normalize-reference", label: "Normalize · reference" },
  { value: "detrend", label: "Detrend" },
  { value: "derivative-first", label: "Derivative · dY/dX" },
  { value: "derivative-second", label: "Derivative · d²Y/dX²" },
  { value: "integral", label: "Integral · cumulative ∫Y dx" },
  { value: "log-derivative", label: "Derivative · dlog(Y)/dlog(X)" },
  { value: "fft", label: "Spectrum · FFT / PSD / phase" },
  { value: "filter", label: "Filter · frequency domain" },
  { value: "correlation", label: "Cross-correlation" },
];

export default function SignalOperationPicker({ value, onChange }: {
  value: SignalOperation;
  onChange: (operation: SignalOperation) => void;
}) {
  return (
    <label className="qz-signal-field">Operation
      <Select value={value} onChange={(event) => onChange(event.target.value as SignalOperation)} options={OPTIONS} />
    </label>
  );
}
