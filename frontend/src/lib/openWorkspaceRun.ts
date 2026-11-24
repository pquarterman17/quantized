// The cancellable half of Open / Append workspace (RESULT_ACCEPTANCE_AUDIT
// part 4, row 7). Lazy on purpose: lib/openWorkspaceCommand.ts is eager and
// has no byte headroom, so the StatusBar op, its Cancel and the abort race
// live here and load when a file has been picked.
//
// Cancel = the parse is abandoned (the worker is terminated when there is
// one) and `null` comes back, so the caller never reaches `dispatch`: the
// current workspace is untouched. An answer that arrives after Cancel is
// dropped here and never applied (fail closed).
//
// Progress: `JSON.parse` in the worker is one indivisible step, so there is
// no honest fraction to show. Where the size is known (a picked File) the
// label carries it so a large open reads as "this is big", not as a hang
// (provisional, owner to confirm).

import { endOp, updateOp, type OpId } from "../store/pendingOps";
import { parentDirectory } from "./importEntry";
import type { ViewportSize } from "./parseWorkspaceFile";
import type { LoadedWorkspace } from "./workspace";
import { workspaceCodec } from "./workspaceCodecLazy";

type SetStatus = (message: string) => void;

export function sizeLabel(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** Run `load` under the caller's StatusBar op `id`, adding Cancel. Resolves null when
 *  cancelled (status says so); rejects when `load` fails. */
export async function cancellableOpen<T>(
  id: OpId,
  label: string,
  verb: string,
  setStatus: SetStatus,
  load: (signal: AbortSignal) => Promise<T>,
  bytes?: number,
): Promise<T | null> {
  const controller = new AbortController();
  // The caller registered the op at the pick (so it is busy before this chunk
  // loads); this attaches Cancel and the size to that same entry.
  updateOp(id, bytes ? `${label} (${sizeLabel(bytes)})` : label, () => controller.abort());
  const aborted = new Promise<null>((resolve) =>
    controller.signal.addEventListener("abort", () => resolve(null), { once: true }),
  );
  try {
    const work = load(controller.signal);
    work.catch(() => {}); // a failure after Cancel is not reported
    const value = await Promise.race([work, aborted]);
    if (controller.signal.aborted) {
      setStatus(`${verb} cancelled — the current workspace is unchanged`);
      return null;
    }
    return value;
  } catch (error) {
    if (controller.signal.aborted) {
      setStatus(`${verb} cancelled — the current workspace is unchanged`);
      return null;
    }
    throw error;
  } finally {
    endOp(id);
  }
}

/** Browser-picker path: parse the picked File (in a worker where there is one). */
export function openPickedFile(
  id: OpId, label: string, verb: string, setStatus: SetStatus, file: File, viewport: ViewportSize,
): Promise<LoadedWorkspace | null> {
  return cancellableOpen(id, label, verb, setStatus, (signal) =>
    import("./parseWorkspaceFile").then((m) => m.parseWorkspaceFile(file, viewport, signal)), file.size);
}

/** Desktop path: the native dialog already read the text; parse it with the lazy codec. */
export function openNativeContent(
  id: OpId, label: string, verb: string, setStatus: SetStatus,
  native: { content: string; path: string }, viewport: ViewportSize,
): Promise<LoadedWorkspace | null> {
  return cancellableOpen(id, label, verb, setStatus, () =>
    workspaceCodec().then(({ parseWorkspace }) =>
      parseWorkspace(native.content, viewport, { projectDir: parentDirectory(native.path) || undefined }),
    ), native.content.length);
}
