// The eager face of `./objectMenus` (bundle diet slice 30,
// `plans/BUNDLE_HEADROOM.md`): the annotation and shape object menus, their
// registry actions and the selection mini-toolbar's strip only run after the
// user acts on a plot object, so they load on demand. This is the
// `lib/axisExtrasHook.ts` getter shape: `objectMenus()` is the module once it
// has loaded, and a caller holding it runs on the gesture's own frame,
// exactly as the eager import did.
//
// WARM-UP. A plot object has to exist before anything here can run (a
// right-click or double-click needs an annotation or a shape under the
// pointer; the mini-toolbar needs a selection), so `useAnnotationEdit` and
// `useShapeEdit` start the load as soon as their canvas bridge exists, and
// `useShapeDraw` as soon as the text-box tool is armed. A gesture after that
// finds the module cached.
//
// LOAD FAILURE. A gesture that finds no module waits for the load; if the
// load fails it says so in a toast and nothing opens. Nothing is cached on a
// failure, so the next gesture tries again. A failed warm-up is silent.

import { toast } from "../../store/toasts";

type ObjectMenus = typeof import("./objectMenus");

let loaded: ObjectMenus | null = null;
let inflight: Promise<ObjectMenus> | null = null;

/** The loaded module, or null while it has not loaded yet. */
export function objectMenus(): ObjectMenus | null {
  return loaded;
}

/** Load the module once; a failed load is forgotten so the next call retries. */
export function loadObjectMenus(): Promise<ObjectMenus> {
  if (loaded) return Promise.resolve(loaded);
  inflight ??= import("./objectMenus").then(
    (m) => (loaded = m),
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

/** Run `run` with the module: now, when it has loaded, otherwise once it
 *  has. A load that fails is reported and `run` never runs. */
export function withObjectMenus(run: (m: ObjectMenus) => void): void {
  if (loaded) {
    run(loaded);
    return;
  }
  loadObjectMenus().then(run, (e: unknown) => {
    toast(`Could not load the object menu: ${e instanceof Error ? e.message : "error"}. Try again.`, "danger");
  });
}
