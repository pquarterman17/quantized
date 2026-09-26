// Shared live-preview machinery for the Reshape & combine and Resample
// workshops (`components/workshops/transformPreview/useReshapePreview.ts`,
// `components/workshops/resample/useResample.ts`) — P2.5 review finding 7.
// Both hooks debounce an edit into a background compute keyed on the SAME
// identity-token shape (the store replaces a `Dataset` object on every edit
// — data, exclusions, filters — so a new object means possibly-new rows),
// and both gate a unit-mismatch confirmation on "acknowledged for exactly
// this preview key". This used to be three near-identical blocks in each
// file; extracted here rather than duplicated a third time. Pure React-hook
// helpers only — no store/API imports, so this stays a leaf both workshops
// (and the pipeline they compute through) can depend on freely.

import { useEffect, useRef, useState } from "react";

/** An object's identity token (e.g. a `Dataset` the store replaces on every
 *  edit). ONE shared WeakMap/counter across every caller: a token is only
 *  ever compared within the caller's OWN key, never across callers, so
 *  sharing the counter changes no caller's behavior — it just means the
 *  numbers interleave between the two workshops, which nothing reads. */
const tokens = new WeakMap<object, number>();
let nextToken = 0;
export function tokenOf(o: object): number {
  let t = tokens.get(o);
  if (t === undefined) {
    t = ++nextToken;
    tokens.set(o, t);
  }
  return t;
}

/** A ref that always holds the LATEST `value`, updated after every render.
 *  A debounced preview effect reads `ref.current` when its timer fires, so
 *  it sees the freshest inputs without re-running (and re-debouncing) every
 *  time an unrelated store change hands those inputs a new object identity
 *  — only a change to the effect's own key (below) should do that. */
export function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Runs `run` once `delayMs` after `key` last changed, skipped entirely
 *  while `key` is `""` (the form has nothing previewable yet) and cancelled
 *  on the next change or unmount. `run` may return its own cleanup — e.g.
 *  "this response is stale, abort/ignore it" — invoked the same way. `run`
 *  itself is intentionally NOT a dependency: both workshops close over their
 *  latest inputs via `useLatestRef` precisely so the timer restarts only
 *  when `key` (the thing that actually means "the preview is now stale")
 *  changes, not on every render. */
export function useDebouncedPreview(key: string, delayMs: number, run: () => void | (() => void)): void {
  useEffect(() => {
    if (key === "") return undefined;
    let cleanup: void | (() => void);
    const timer = setTimeout(() => {
      cleanup = run();
    }, delayMs);
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` closes over the latest inputs; only `key` should restart the timer.
  }, [key, delayMs]);
}

/** "Acknowledged for exactly this preview key" — a unit-mismatch confirm
 *  must re-arm whenever the key changes (a different form or input), so an
 *  acknowledgment can never silently carry over to an unrelated mismatch. */
export function useAckForKey(key: string): { acknowledged: boolean; setAcknowledged: (ok: boolean) => void } {
  const [ackFor, setAckFor] = useState<string | null>(null);
  return {
    acknowledged: ackFor === key && key !== "",
    setAcknowledged: (ok) => setAckFor(ok ? key : null),
  };
}
