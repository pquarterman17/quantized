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

// A unique sentinel, never `===` to anything a caller could pass — distinct
// from the review round 2 fix below: `keyRef` starts here so "first render"
// is unambiguous even when `value` itself is `undefined`.
const UNSET: unique symbol = Symbol("useStableByValue.unset");
type Key = typeof UNSET | undefined | null | string;

/** Returns a value that keeps its PREVIOUS reference across renders whenever
 *  `serialize(value)` is unchanged from last time, even if `value` itself is
 *  a freshly allocated object/array. `serialize` must be a total,
 *  order-stable function of `value`'s content (JSON.stringify is fine for
 *  plain data shapes; the fields it walks must always appear in the same
 *  order every caller constructs them in).
 *
 *  Round 2 (adversarial review): `null` and `undefined` are their OWN `Key`
 *  variants, never coerced to a string or cast through `serialize` — a
 *  `T = Foo[] | null` caller is sound (no runtime TypeError on `null`), and
 *  neither can collide with a real value that happens to serialize the same
 *  way, since `Key` keeps them as distinct types, not stringified sentinels.
 *  Reference-equal input (`value === ` the previously stored value) short-
 *  circuits before `serialize` ever runs — the common case, since most
 *  renders simply pass the same object back — so a defined value is
 *  serialized AT MOST ONCE per render, only when its identity actually
 *  changed and its content still needs checking. */
export function useStableByValue<T>(value: T, serialize: (value: NonNullable<T>) => string): T {
  const ref = useRef(value);
  const keyRef = useRef<Key>(UNSET);

  if (keyRef.current !== UNSET && value === ref.current) {
    return ref.current;
  }

  const isNullish = value === undefined || value === null;
  const key: Key = isNullish ? (value as undefined | null) : serialize(value as NonNullable<T>);
  if (keyRef.current === UNSET || key !== keyRef.current) {
    keyRef.current = key;
    ref.current = value;
  }
  return ref.current;
}
