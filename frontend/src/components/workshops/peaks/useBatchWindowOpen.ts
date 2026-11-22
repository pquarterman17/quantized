// Whether the Peaks panel's Batch integrate window is open. The window also
// opens for "Open in Batch integrate" on a committed trend (lane RO2): a new
// reopen session shows it, and closing the window (its panel scope) ends the
// session.

import { useEffect, useState } from "react";

import { useToolReopen } from "../../../store/toolReopen";

export function useBatchWindowOpen(): [boolean, (open: boolean) => void] {
  const nonce = useToolReopen((s) => s.sessions["peak-batch-integrate"]?.nonce ?? 0);
  const [open, setOpen] = useState(nonce > 0);
  useEffect(() => { if (nonce > 0) setOpen(true); }, [nonce]);
  return [open, setOpen];
}
