// Round 7 (adversarial review, item 4): a value that is CONTENT-equal to the
// previous render but a fresh object/array identity (e.g. `structuredClone`
// on every write of an otherwise-unchanged field) still trips any effect or
// memo that lists it as a dependency — React's Object.is check only sees
// "different reference". The concrete case this was written for:
// store/windowDocuments.ts's `syncPlotWindow` rebuilds a FigureDocument via
// `createFigureDocument` on every sync (rename, focus handoff, minimize/
// restore, recipe apply, …), which itself `structuredClone`s
// `bindings.errors` unconditionally — so `PlotStage.tsx`'s
// `focusedDocumentErrors` selector returns a new array on nearly every
// store write even when the bindings inside it are byte-identical, and
// `usePlotPayload.ts`'s base-fetch effect (which lists it as a dependency,
// since decimation eligibility reads it) re-issues a whole `/api/plot/
// series` round trip for no reason.
//
// `useStableByValue` breaks that: it returns the SAME reference across
// renders as long as `serialize(value)` matches, so a dependent effect/memo
// only re-runs when the content actually changed. Deliberately generic (not
// ErrorBinding-specific) so the same fix applies wherever the codebase hits
// this pattern next.

import { useRef } from "react";

/** Returns a value that keeps its PREVIOUS reference across renders whenever
 *  `serialize(value)` is unchanged from last time, even if `value` itself is
 *  a freshly allocated object/array. `serialize` must be a total,
 *  order-stable function of `value`'s content (JSON.stringify is fine for
 *  plain data shapes; the fields it walks must always appear in the same
 *  order every caller constructs them in). `value === undefined` is handled
 *  as its own case — `serialize` is never called on it — so a defined value
 *  can never collide with the "absent" state by coincidentally serializing
 *  the same way. */
export function useStableByValue<T>(value: T, serialize: (value: NonNullable<T>) => string): T {
  const ref = useRef(value);
  const prevKeyRef = useRef<string | undefined>(
    value === undefined ? undefined : serialize(value as NonNullable<T>),
  );
  const key = value === undefined ? undefined : serialize(value as NonNullable<T>);
  const changed = value === undefined ? ref.current !== undefined : key !== prevKeyRef.current;
  if (changed) {
    prevKeyRef.current = key;
    ref.current = value;
  }
  return ref.current;
}
