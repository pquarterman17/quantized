import { useEffect } from "react";

import { SEED_TTL_MS, useSignalOperationSeed } from "../../../store/signalOperationSeed";
import { Select } from "../../primitives";
import type { SignalOperation } from "./signalProcessingModel";
import { SIGOP_FILTER_OPTIONS, type SigopFilterMethod } from "./sigopModel";

export type PickerOperation = SignalOperation | SigopFilterMethod | "spectrogram";

const OPTIONS: { value: PickerOperation; label: string }[] = [
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
  { value: "spectrogram", label: "Spectrogram · short-time FFT" },
  ...SIGOP_FILTER_OPTIONS,
];

/** Apply a pending ⌘K deep-link request (`store/signalOperationSeed.ts`)
 *  through the panel's own `pick`, once, whether the panel was just mounted by
 *  the command or was already open. An unknown id is dropped, never applied. */
export function useAppliedOperationSeed(pick: (operation: string) => void, hold = false): void {
  const op = useSignalOperationSeed((s) => s.op);
  const nonce = useSignalOperationSeed((s) => s.nonce);
  useEffect(() => {
    // `hold` (a commit is in flight) queues the request: it is applied when the
    // commit ends, or on the next open if the commit closes the panel.
    if (op === null || hold) return;
    if (Date.now() - useSignalOperationSeed.getState().at > SEED_TTL_MS) {
      useSignalOperationSeed.getState().clear(); // stale: the panel never loaded
      return;
    }
    if (OPTIONS.some((o) => o.value === op)) pick(op);
    useSignalOperationSeed.getState().clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pick` is a fresh closure per render; the request is keyed by nonce
  }, [op, nonce, hold]);
}

export default function SignalOperationPicker({ value, onChange }: {
  value: PickerOperation;
  onChange: (operation: PickerOperation) => void;
}) {
  return (
    <label className="qz-signal-field">Operation
      <Select value={value} onChange={(event) => onChange(event.target.value as PickerOperation)} options={OPTIONS} />
    </label>
  );
}
