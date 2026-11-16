import { useEffect } from "react";

import { useSignalOperationSeed } from "../../../store/signalOperationSeed";
import { Select } from "../../primitives";
import type { SignalOperation } from "./signalProcessingModel";
import { SIGOP_FILTER_OPTIONS, type SigopFilterMethod } from "./sigopModel";

const OPTIONS: { value: SignalOperation | SigopFilterMethod; label: string }[] = [
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
  ...SIGOP_FILTER_OPTIONS,
];

/** Apply a pending ⌘K deep-link request (`store/signalOperationSeed.ts`)
 *  through the panel's own `pick`, once, whether the panel was just mounted by
 *  the command or was already open. An unknown id is dropped, never applied. */
export function useAppliedOperationSeed(pick: (operation: string) => void): void {
  const op = useSignalOperationSeed((s) => s.op);
  const nonce = useSignalOperationSeed((s) => s.nonce);
  useEffect(() => {
    if (op === null) return;
    if (OPTIONS.some((o) => o.value === op)) pick(op);
    useSignalOperationSeed.getState().clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pick` is a fresh closure per render; the request is keyed by nonce
  }, [op, nonce]);
}

export default function SignalOperationPicker({ value, onChange }: {
  value: SignalOperation | SigopFilterMethod;
  onChange: (operation: SignalOperation | SigopFilterMethod) => void;
}) {
  return (
    <label className="qz-signal-field">Operation
      <Select value={value} onChange={(event) => onChange(event.target.value as SignalOperation | SigopFilterMethod)} options={OPTIONS} />
    </label>
  );
}
