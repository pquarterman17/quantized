import { useEffect } from "react";

import { SEED_TTL_MS, useSignalOperationSeed } from "../../../store/signalOperationSeed";
import { Select } from "../../primitives";
import { OPERATION_OPTIONS, type PickerOperation } from "./signalOptions";

export type { PickerOperation } from "./signalOptions";

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
    if (OPERATION_OPTIONS.some((o) => o.value === op)) pick(op);
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
      <Select value={value} onChange={(event) => onChange(event.target.value as PickerOperation)} options={OPERATION_OPTIONS} />
    </label>
  );
}
