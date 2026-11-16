// The main-thread viewport capture `parseWorkspaceFile` threads into the
// `.dwk` parse, moved out of lib/parseWorkspaceFile.ts (bundle diet slice 30,
// plans/BUNDLE_HEADROOM.md): the Open/Append command reads it at pick time,
// in the eager chunk, and the parse entry point itself loads once a file is
// picked. lib/parseWorkspaceFile.ts re-exports it.

import type { ViewportSize } from "./workspaceParseCore";

/** The real browser viewport, captured on the calling (main) thread.
 *  `parseWorkspace`'s `toolWindowLayout` clamp defaults to
 *  `window.innerWidth/innerHeight` when no `viewport` is passed — but
 *  `window` doesn't exist inside a worker, so that default would silently
 *  clamp to its own 1280x800 fallback instead. Reading it here and
 *  threading it through explicitly keeps the worker path byte-for-byte
 *  identical to the synchronous path's prior (implicit) default. */
export function currentViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight };
}
