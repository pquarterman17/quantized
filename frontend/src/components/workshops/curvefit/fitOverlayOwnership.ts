// Curve Fit: clear the plot's fit overlay only if it is still `own` (atomic
// compare-and-clear), so a tool that withdraws its curve (an out-of-date result,
// unmount) never removes someone else's.
import type { FitOverlay } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export function takeBackOverlay(own: FitOverlay | null): void {
  if (own) useApp.setState((st) => (st.fitOverlay === own ? { fitOverlay: null } : {}));
}
