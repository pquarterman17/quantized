// On-demand loader for the `.dwk` codec (bundle headroom slice 9,
// `plans/BUNDLE_HEADROOM.md`) — the `store/plotRecipeApplyLazy.ts` shape.
//
// `lib/workspace.ts` is the whole workspace file format: `parseWorkspace` and
// its per-field sanitizers, `serializeWorkspace`, and the modules only they
// reach (`workspaceDatasetParse`, `workspaceSerialize`, `plotRecipeIO`,
// `pageDocument`, `workspaceOrigin`, `peakTable`, ...). Every entry point into
// it is already `async` — Save / Save As (after resolving pending books and a
// file dialog), Open and Open Recent (after a file read), and autosave
// (IndexedDB has no synchronous mode) — so it had no business in the entry
// chunk: the React 19.3 bump spent its bytes (see this slice's section for the
// measurement). Nothing on first paint parses or writes a workspace; the
// startup autosave restore is the earliest caller, and it starts this fetch
// alongside its own storage read (`lib/autosave.ts`).
//
// FAILURE CONTRACT. A chunk that will not load rejects the caller's existing
// promise, before anything has been read into or written from the store, and
// each caller reports it on the channel it already uses for a parse or
// serialize failure (a status line + danger toast for Save / Open, the
// persistent "autosave failing" health for autosave, a danger toast for the
// startup restore — which REJECTS rather than reading as "nothing to restore").
// A rejected load is not cached: `inflight` is dropped in its `.catch`, so the
// next gesture refetches. A RESOLVED promise is cached, to keep concurrent
// callers on one fetch.
//
// NOTE: `lib/workspace.ts` and `lib/workspaceParseCore.ts` must stay free of
// static importers reachable from the entry chunk, or the bundler folds them
// straight back in. `src/architecture.test.ts`'s SEAMS list is the guard.

import { toast } from "../store/toasts";

type WorkspaceCodec = typeof import("./workspace");

let inflight: Promise<WorkspaceCodec> | null = null;

/** The `.dwk` parse/serialize module, fetched once per session. */
export function workspaceCodec(): Promise<WorkspaceCodec> {
  inflight ??= import("./workspace").catch((e: unknown) => {
    // Not cached on failure: the next gesture retries rather than replaying
    // one transient fetch failure for the rest of the session.
    inflight = null;
    throw e;
  });
  return inflight;
}

/** `workspaceCodec()` for a caller whose failure channel is "status line +
 *  danger toast, then bail" (Save and Save As, `store/workspaceIO.ts`):
 *  resolves null after reporting a load failure, nothing written. */
export async function workspaceCodecOrReport(
  what: string,
  setStatus: (msg: string) => void,
): Promise<WorkspaceCodec | null> {
  try {
    return await workspaceCodec();
  } catch (e: unknown) {
    const msg = `${what} failed — couldn't load the workspace file codec: ${e instanceof Error ? e.message : "error"}`;
    setStatus(msg);
    toast(msg, "danger");
    return null;
  }
}

/** Test-only: forget the cached promise so a spec can exercise the COLD
 *  (deferred) path, or a freshly `vi.doMock`ed module. Production code never
 *  calls this. */
export function resetWorkspaceCodecForTests(): void {
  inflight = null;
}
