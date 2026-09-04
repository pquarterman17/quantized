// Domain-scoped store hook (repo evaluation 2026-09-03, bounded first slice).
//
// `useApp` composes 42 slice interfaces into one `AppState` (see
// store/useApp.ts's `extends` list); every component that wants ANY piece of
// state imports the same god-hook, so a file's dependency on (say) window
// management is invisible in its imports — you have to read the selector
// bodies to find out. This hook narrows the TYPE surface a component may
// read to `WindowsSlice` alone: importing `useWindowsStore` instead of
// `useApp` makes "this component touches window state" visible at the
// import line, and gives a future physical split of the store (windows.ts
// already lives in its own file) a seam to split along.
//
// It does NOT change rerender behaviour by itself — `useApp(selector)` and
// `useWindowsStore(selector)` subscribe to the exact same store instance the
// exact same way; only the selector's declared parameter type narrows.
//
// Soundness: `WindowsSlice` is one of the interfaces `AppState extends`, so
// `AppState` is a structural subtype of `WindowsSlice` (every `AppState` value
// already has every `WindowsSlice` field) — a selector typed
// `(s: WindowsSlice) => T` is safe to run against the real `AppState`
// instance, so casting it as `(s: AppState) => T` here is sound, not a
// loophole.
import { useShallow } from "zustand/react/shallow";

import { useApp, type AppState } from "../useApp";
import type { WindowsSlice } from "../windows";

export function useWindowsStore<T>(selector: (s: WindowsSlice) => T): T {
  return useApp(selector as (s: AppState) => T);
}

/** Shallow-compared variant — for a selector that returns a fresh object/array
 *  each call (e.g. picking several fields at once), so the component only
 *  rerenders when one of the picked values actually changes. */
export function useWindowsStoreShallow<T>(selector: (s: WindowsSlice) => T): T {
  return useApp(useShallow(selector as (s: AppState) => T));
}
