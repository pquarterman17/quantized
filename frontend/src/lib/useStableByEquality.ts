// Content-stable references for large plot inputs: `useStableByValue`
// (./useStableValue.ts) serializes, which is too slow for a row-length
// error-bar column; these compare structurally, once per new identity.

import { useRef } from "react";

/** Structural equality over plain data: primitives (`Object.is`), arrays,
 *  Maps and plain objects, recursively. Anything else (a function, a class
 *  instance) compares by identity, so an unknown shape errs toward "changed". */
export function sameContent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const o = b as Record<string, unknown> & unknown[] & Map<unknown, unknown>;
  if (Array.isArray(a)) return a.length === o.length && a.every((v, i) => sameContent(v, o[i]));
  if (a instanceof Map) return a.size === o.size && [...a].every(([k, v]) => o.has(k) && sameContent(v, o.get(k)));
  if (Object.getPrototypeOf(a) !== Object.prototype) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(o).length && keys.every((k) => k in o && sameContent((a as typeof o)[k], o[k]));
}

/** `useStableByValue` for values too large to serialize every render (a
 *  row-length error-bar column): keeps the previous reference while
 *  `sameContent` says the content is unchanged. It runs only when the identity
 *  changes, once per new identity — a content-equal value that keeps
 *  arriving is remembered as seen, not re-compared on every render. */
export function useStableByEquality<T>(value: T): T {
  const held = useRef(value);
  const seen = useRef(value);
  if (value !== seen.current) {
    seen.current = value;
    if (!sameContent(held.current, value)) held.current = value;
  }
  return held.current;
}
