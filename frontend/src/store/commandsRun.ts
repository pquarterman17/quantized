// The command runner, split out of store/commands.ts (bundle diet slice 32) and
// re-exported from it with `export *`: the ⌘K palette and the menu model (both
// lazy) are the only callers. A sync command runs as before; an async one is
// registered in pendingOps for its duration.

import { noteCommand } from "../lib/lastAction";
import type { Action } from "./commands";
import { withOp } from "./pendingOps";
import { toast } from "./toasts";

/** True when `x` looks like a promise (has a callable `.then`) — the runtime
 *  check `runAction` needs because `Action.run` is typed `() => void` even
 *  though several commands are `async` bodies (TypeScript's void-return
 *  covariance rule lets that satisfy the type; the real value is only
 *  hidden from the STATIC type, never from what actually comes back at
 *  runtime). */
function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    (typeof x === "object" || typeof x === "function") &&
    x !== null &&
    typeof (x as { then?: unknown }).then === "function"
  );
}

/** THE chokepoint (P3.4 slice 2, 2026-07-26 audit gap #2): every surface that
 *  invokes an `Action` — the ⌘K palette, the menu bar (dropdown items AND
 *  the Help menu) — calls this instead of `action.run()` directly.
 *
 *  A sync command runs exactly as before: zero observable change. An async
 *  command (`run()` returns a thenable — every File-menu export is one)
 *  gets registered in the shared pendingOps store for its duration via
 *  `withOp`, which is what lets StatusBar show its label instead of nothing
 *  happening until the eventual completion/failure toast. This function
 *  never changes what a command DOES — it only observes the promise the
 *  command already returns.
 *
 *  A rejection (after `withOp` unregisters + rethrows) becomes a danger
 *  toast naming the command. A command that reports its own failure via
 *  status/toast resolves normally, so this never double-reports; it is the
 *  safety net for a rejection nothing else reported — a lazy command
 *  body's chunk failing to load was silent here before 2026-10-01. */
export function runAction(action: Action): void {
  noteCommand(action); // Repeat last action / Reopen last dialog (lib/lastAction.ts)
  const result = (action.run as () => unknown)();
  if (isThenable(result)) {
    // Silent-failure audit (2026-10-01): a command that reports its own
    // failure resolves, so a rejection reaching here was reported by nobody
    // (e.g. Pack Project's or Send to Origin's lazy chunk failing to load).
    void withOp(action.label, () => Promise.resolve(result)).catch((e: unknown) => {
      toast(`${action.label.replace(/…$/, "")} failed: ${e instanceof Error ? e.message : "error"}`, "danger");
    });
  }
}
