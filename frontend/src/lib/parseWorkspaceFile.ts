// Off-main-thread `.dwk` parse entry point (P3.4 slice 3). Picks a picked
// File apart in a module Worker when one is available (every real browser),
// falling back to the synchronous path otherwise (jsdom/tests, or an
// embedding webview without Worker support). Both branches call the exact
// same `parseWorkspaceBlob` (worker.ts:workspaceParseCore.ts) — the worker
// via postMessage, the fallback directly — so the two paths can never
// diverge on validation logic. See parseWorkspaceFile.test.ts for the
// equivalence + error-parity coverage.
//
// The worker receives the `File` itself, not its text: structured-cloning a
// `File`/`Blob` is a cheap reference hand-off (no byte copy), and the worker
// does its own `.text()` read — so the main thread never materializes the
// raw JSON string for a large workspace. What the main thread DOES still pay
// for is the structured-clone RECEIVE of the parsed result (a large
// `LoadedWorkspace` object) and applying it to the store afterward.
//
// Measured 2026-07-26 at the 197 MB / 1,000,000-row P3.4 slice 3 case
// (docs/performance_envelope.md "Large derived workspace"): the parse+
// validate this moves off-thread is genuinely fast (~0.4-0.6 s) and the
// clone-receive that replaces it on the main thread costs a COMPARABLE
// ~0.7-0.8 s — a wash on that shape, not a clear net win, because the
// reopen's actual dominant cost is downstream React re-render/window-mount
// work (~5-6 s) that this slice does not touch. The win here is real but
// narrower than "5.8 s of JSON.parse" implied: main-thread JS blocking
// during the parse itself is eliminated; the overall observed freeze on a
// SESSION this heavy (20 datasets, 11 windows) does not meaningfully drop.
// A workspace whose size is dominated by data (few windows, no 1M-row
// grid) should see a cleaner win, since clone cost scales with payload size
// while the render-mount cost does not.

import { parseWorkspaceBlob, type ViewportSize, type WorkspaceParseResult } from "./workspaceParseCore";
import type { LoadedWorkspace } from "./workspace";

export type { ViewportSize } from "./workspaceParseCore";

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

function unwrap(result: WorkspaceParseResult): LoadedWorkspace {
  if (result.ok) return result.workspace;
  throw new Error(result.error);
}

/** Parse a picked `.dwk` File into a `LoadedWorkspace`, off the main thread
 *  when possible. Rejects with the same `Error` (same `.message`) either
 *  path would produce — a corrupt/invalid file fails identically whether or
 *  not a Worker was available. */
export function parseWorkspaceFile(file: File, viewport: ViewportSize): Promise<LoadedWorkspace> {
  if (typeof Worker === "undefined") {
    return parseWorkspaceBlob(file, viewport).then(unwrap);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workspaceParse.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<WorkspaceParseResult>) => {
      worker.terminate();
      try {
        resolve(unwrap(e.data));
      } catch (err) {
        reject(err as Error);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      worker.terminate();
      reject(new Error(e.message || "workspace parse failed"));
    };
    worker.postMessage({ file, viewport });
  });
}
