import { useEffect, useState } from "react";

/** Load an on-demand dialog only after its first opening, then leave it mounted
 * while closed. That preserves local dialog state (for example Preferences'
 * active tab) exactly as the former eager mount did. Extracted from
 * AppOverlayPanels.tsx (component-ceiling ratchet); lives in its lazy chunk. */
export function useKeepMountedAfterOpen(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted;
}
