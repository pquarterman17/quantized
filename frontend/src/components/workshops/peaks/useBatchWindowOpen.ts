// Whether one of the Peaks panel's tool windows is open (Batch integrate by
// default; Align to peak passes its producer id). The window also
// opens for "Open in Batch integrate" on a committed trend (lane RO2): a new
// reopen session shows it, and closing the window (its panel scope) ends the
// session.

import { useEffect, useState } from "react";

import { useToolReopen } from "../../../store/toolReopen";

export function useBatchWindowOpen(tool = "peak-batch-integrate"): [boolean, (open: boolean) => void] {
  const nonce = useToolReopen((s) => s.sessions[tool]?.nonce ?? 0);
  const end = useToolReopen((s) => s.end);
  const [open, setOpen] = useState(nonce > 0);
  useEffect(() => { if (nonce > 0) setOpen(true); }, [nonce]);
  // Closing the window ends the session even if the window never mounted (its chunk failed).
  return [open, (next) => { if (!next) end(tool); setOpen(next); }];
}
