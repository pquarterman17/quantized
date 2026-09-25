// On-demand loader for Save / Save As (bundle headroom slice 9,
// `plans/BUNDLE_HEADROOM.md`) — the `store/plotRecipeApplyLazy.ts` shape.
//
// `store/workspaceIO.ts` is the write half of the `.dwk` workflow: resolve
// pending books, pick a destination, the project-lock checks around a native
// write, the browser-download fallback. `useApp.ts`'s `saveWorkspace` /
// `saveWorkspaceToFile` were thin delegates to it and both were ALREADY
// `async` (`Promise<void>`), so these two functions keep that exact shape and
// fetch the real ones on first use; `useApp.ts` only changed its import path.
// (`appendWorkspace`, which is synchronous, no longer lives in that module —
// see store/workspaceHydration.ts.)
//
// FAILURE CONTRACT. A chunk that will not load settles the save (it never
// rejects, like the real functions) with the "save failed" status + danger
// toast every other save failure uses, before anything is resolved, picked or
// written. A rejected load is not cached; the next Save refetches.
//
// NOTE: `store/workspaceIO.ts` must stay free of static value importers
// reachable from the entry chunk; `src/architecture.test.ts`'s SEAMS list is
// the guard.

import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;
type WorkspaceIO = typeof import("./workspaceIO");

let inflight: Promise<WorkspaceIO> | null = null;

/** The save module, fetched once per session. */
export function workspaceIOCore(): Promise<WorkspaceIO> {
  inflight ??= import("./workspaceIO").catch((e: unknown) => {
    inflight = null; // not cached on failure: the next Save retries
    throw e;
  });
  return inflight;
}

function saveLoadFailed(get: SliceGet): (e: unknown) => void {
  return (e) => {
    const msg = `save failed — couldn't load the save module: ${e instanceof Error ? e.message : "error"}`;
    get().setStatus(msg);
    toast(msg, "danger");
  };
}

export function runSaveWorkspaceToFile(get: SliceGet): Promise<void> {
  return workspaceIOCore().then((io) => io.runSaveWorkspaceToFile(get), saveLoadFailed(get));
}

export function runSaveWorkspace(get: SliceGet): Promise<void> {
  return workspaceIOCore().then((io) => io.runSaveWorkspace(get), saveLoadFailed(get));
}

/** Test-only: forget the cached promise (cold path / `vi.doMock`). */
export function resetWorkspaceIOCoreForTests(): void {
  inflight = null;
}
