// The eager face of `./objectMenus` (bundle diet slice 30,
// `plans/BUNDLE_HEADROOM.md`): the annotation and shape object menus, their
// registry actions and the selection mini-toolbar's strip only run after the
// user acts on a plot object, so they load on demand. This is the
// `lib/axisExtrasHook.ts` getter shape: `objectMenus()` is the module once it
// has loaded. A gesture that finds it loaded runs on its own frame.
//
// WARM-UP. A plot object has to exist before anything here can run (a
// right-click or double-click needs an annotation or a shape under the
// pointer; the mini-toolbar needs a selection), so `useAnnotationEdit` and
// `useShapeEdit` start the load as soon as their canvas bridge exists, and
// `useShapeDraw` as soon as the text-box tool is armed.
//
// A GESTURE BEFORE THE LOAD LANDS is queued, and only the newest queued
// gesture runs. It is dropped if the user moves on first: a pointerdown
// anywhere, Escape, a menu close (`cancelPendingObjectMenu`), or whatever its
// caller's `stillValid` check rejects when the load lands (the object hooks:
// a switch away from the pointer tool).
//
// LOAD FAILURE. A queued gesture whose load fails says so in a toast and
// nothing opens. Nothing is cached on a failure, so the next gesture tries
// again. A failed warm-up is silent.

import { toast } from "../../store/toasts";

type ObjectMenus = typeof import("./objectMenus");

let loaded: ObjectMenus | null = null;
let inflight: Promise<ObjectMenus> | null = null;
const listeners = new Set<() => void>();

/** The loaded module, or null while it has not loaded yet. */
export function objectMenus(): ObjectMenus | null {
  return loaded;
}

/** Be told once the module has loaded, whichever caller started the load
 *  (the `useSyncExternalStore` subscribe shape). */
export function subscribeObjectMenus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load the module once; a failed load is forgotten so the next call retries. */
export function loadObjectMenus(): Promise<ObjectMenus> {
  if (loaded) return Promise.resolve(loaded);
  inflight ??= import("./objectMenus").then(
    (m) => {
      loaded = m;
      for (const listener of [...listeners]) listener();
      return m;
    },
    (e: unknown) => {
      inflight = null;
      throw e;
    },
  );
  return inflight;
}

/** Start the load ahead of the first gesture. Failures are ignored here. */
export function preloadObjectMenus(): void {
  loadObjectMenus().catch(() => {});
}

/** The newest queued gesture; a queued gesture runs only while it still is. */
let gestureSeq = 0;
let detachCancelers: (() => void) | null = null;

/** Drop the queued gesture, if any (a menu close, a tool change). */
export function cancelPendingObjectMenu(): void {
  gestureSeq += 1;
  detachCancelers?.();
}

/** While a gesture is queued, the user's next pointerdown or Escape drops it.
 *  Capture phase, so a surface that stops propagation cannot hide it. */
function attachCancelers(): void {
  if (detachCancelers || typeof window === "undefined") return;
  const onPointerDown = () => cancelPendingObjectMenu();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") cancelPendingObjectMenu();
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  detachCancelers = () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    detachCancelers = null;
  };
}

/** Run `run` with the module: now, when it has loaded, otherwise once it has,
 *  unless a newer gesture or a cancel came first, or `stillValid` (checked
 *  only for a queued gesture) says no. A load that fails is reported (for a
 *  gesture still current) and `run` never runs. */
export function withObjectMenus(run: (m: ObjectMenus) => void, stillValid: () => boolean = () => true): void {
  const seq = ++gestureSeq;
  if (loaded) {
    detachCancelers?.();
    run(loaded);
    return;
  }
  attachCancelers();
  loadObjectMenus().then(
    (m) => {
      if (seq !== gestureSeq) return;
      detachCancelers?.();
      if (stillValid()) run(m);
    },
    (e: unknown) => {
      if (seq !== gestureSeq) return;
      detachCancelers?.();
      toast(`Could not load the object menu: ${e instanceof Error ? e.message : "error"}. Try again.`, "danger");
    },
  );
}
