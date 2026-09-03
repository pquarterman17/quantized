// Domain-scoped store hook (repo evaluation 2026-09-03, bounded first slice).
//
// `useApp` composes 42 slice interfaces into one `AppState` (see
// store/useApp.ts's `extends` list); every component that wants ANY piece of
// state imports the same god-hook, so a file's dependency on (say) the
// map-ROI/ruler/sector tools is invisible in its imports — you have to read
// the selector bodies to find out. This hook narrows the TYPE surface a
// component may read to `RoisSlice` alone: importing `useRoisStore` instead
// of `useApp` makes "this component touches ROI state" visible at the import
// line, and gives a future physical split of the store (rois.ts already
// lives in its own file) a seam to split along.
//
// It does NOT change rerender behaviour by itself — `useApp(selector)` and
// `useRoisStore(selector)` subscribe to the exact same store instance the
// exact same way; only the selector's declared parameter type narrows.
//
// Soundness: `RoisSlice` is one of the interfaces `AppState extends`, so
// `AppState` is a structural subtype of `RoisSlice` (every `AppState` value
// already has every `RoisSlice` field) — a selector typed
// `(s: RoisSlice) => T` is safe to run against the real `AppState` instance,
// so casting it as `(s: AppState) => T` here is sound, not a loophole.
import { useShallow } from "zustand/react/shallow";

import { useApp, type AppState } from "../useApp";
import type { RoisSlice } from "../rois";

export function useRoisStore<T>(selector: (s: RoisSlice) => T): T {
  return useApp(selector as (s: AppState) => T);
}

/** Shallow-compared variant — for a selector that returns a fresh object/array
 *  each call (e.g. picking several fields at once), so the component only
 *  rerenders when one of the picked values actually changes. */
export function useRoisStoreShallow<T>(selector: (s: RoisSlice) => T): T {
  return useApp(useShallow(selector as (s: AppState) => T));
}
