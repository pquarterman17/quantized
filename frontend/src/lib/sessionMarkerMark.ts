// The lazy-only half of sessionMarker.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the session-active mark. Only lazy modules call it.
// The code moved here verbatim and sessionMarker.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { ACTIVE_KEY } from "./sessionMarker";

/** Mark this session running. Safe to call more than once. */
export function markSessionActive(): void {
  try {
    localStorage.setItem(ACTIVE_KEY, "1");
  } catch {
    /* storage unavailable — crash detection degrades to "first-run" */
  }
}
