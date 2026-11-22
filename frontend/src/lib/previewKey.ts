// Shared live-preview helpers for the previewing workshops (Reshape &
// combine, Resample, SIMS ...). The debounce / abort / stale-answer machinery
// itself lives in the workbench shell
// (`components/workshops/workbench/useWorkbenchPreview.ts`; the former
// `useDebouncedPreview` here was retired when its last users moved there);
// what stays here is what the hooks share around it: the identity-token key
// shape (the store replaces a `Dataset` object on every edit
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
