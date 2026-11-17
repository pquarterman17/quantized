// Browser "Save in place" through the File System Access API (audit-6 lane O,
// P11/B9). A plain browser tab cannot learn a durable path, so before this
// module every Save downloaded a fresh `workspace.dwk`. Where the API exists
// (Chromium), the first Save As picks a file handle and keeps it, and every
// later Ctrl+S overwrites THAT file. Firefox / Safari have no
// `showSaveFilePicker`: callers fall back to the download, unchanged.
//
// A lazy chunk (`store/browserSave.ts` is the orchestrator).
//
// FAIL CLOSED. A kept handle is only written when all three still hold:
//   1. write permission is still granted (re-requested once, which needs the
//      user gesture the Ctrl+S carries; refused -> the handle is dropped);
//   2. the file is still readable (moved/deleted -> dropped);
//   3. it is byte-for-byte the file we last wrote: the `lastModified:size`
//      stamp taken right after our own write must be unchanged. A different
//      stamp means something else edited it, so we never overwrite it
//      silently. The outcome is "stale", and the caller re-prompts with the
//      save picker, whose OS dialog makes the user confirm the replacement.
// `createWritable` stages into a swap file and only replaces on `close()`, so
// a failed write leaves the previous good file untouched.
//
// The handle belongs to ONE document: `checkHandle` refuses it whenever the store's
// `docEpoch` differs from the one it was saved under (Open, restore, Remove all, undo).

import { useApp } from "../store/useApp";

export interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FsHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
}

interface PickerWindow {
  showSaveFilePicker?: (o: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FsHandle>;
}

export type BrowserSave =
  | { kind: "saved"; name: string; unverified?: true }
  | { kind: "cancelled" }
  | { kind: "stale"; reason: string }
  | { kind: "failed"; reason: string };

/** `epoch` = the document (`useApp.docEpoch`) the handle was saved under. It changes on every
 *  Open / restore / Remove all and is restored by undo/redo, so the handle follows the DOCUMENT. */
interface Held {
  handle: FsHandle;
  stamp: string;
  epoch: number;
}
let held: Held | null = null;
/** A name worth suggesting, valid only for the document (`epoch`) it was learned under. */
let openedName: { name: string; epoch: number } | null = null;
const liveEpoch = (): number => useApp.getState().docEpoch;
/** Mirror the learned name into the store so the title bar can show it. */
const shown = (name: string | null): void => useApp.getState().setBrowserFileName(name);

const picker = (): PickerWindow["showSaveFilePicker"] => (window as unknown as PickerWindow).showSaveFilePicker;
const stampOf = (f: File): string => `${f.lastModified}:${f.size}`;
const errName = (e: unknown): string => (e instanceof Error ? e.name : "");
const errMsg = (e: unknown): string => (e instanceof Error && e.message ? e.message : "error");

/** True when a save picker exists (Chromium); false in Firefox / Safari / jsdom. */
export const canPickSaveFile = (): boolean => typeof picker() === "function";

/** True once a Save As has kept a handle that Ctrl+S can overwrite. */
export const hasSaveHandle = (): boolean => held !== null;

/** The file name a Save As / download should offer: the kept handle's own name,
 *  else the opened workspace's, else the project's, else `workspace.dwk`. */
export function defaultSaveName(projectName?: string | null): string {
  const named = openedName && openedName.epoch === liveEpoch() ? openedName.name : null;
  const base = held?.handle.name ?? named ?? projectName ?? "workspace";
  return /\.(dwk|json)$/i.test(base) ? base : `${base}.dwk`;
}

/** A browser Open really replaced the workspace with `name`'s file: any kept
 *  handle names the OLD file, so it is dropped, and `name` is adopted for the
 *  next download / Save As suggestion. */
export function commitOpened(name?: string): void {
  held = null;
  openedName = name ? { name, epoch: liveEpoch() } : null; // called right after loadWorkspace: the NEW epoch
  shown(name ?? null);
}

/** Forget the kept file and the opened name (a new document has none). */
export function resetBrowserFile(): void {
  held = null;
  openedName = null;
  shown(null);
}

/** Write and close (the swap-file replace happens at close, so a throw here left
 *  the old file intact), then read back the stamp; null = could not verify. */
async function writeThrough(handle: FsHandle, content: string): Promise<string | null> {
  const w = await handle.createWritable();
  try {
    await w.write(content);
    await w.close();
  } catch (e) {
    await w.abort?.().catch(() => undefined);
    throw e;
  }
  return handle.getFile().then(stampOf, () => null);
}

/** Arm (or, unverifiable, drop) the handle after a write. `was` is the `held` this save
 *  started from: if it changed meanwhile (an Open, a Save As, an undo dropped or replaced
 *  it), the late write must not resurrect the old handle under the new document. */
function keep(handle: FsHandle, stamp: string | null, epoch: number, was: Held | null): BrowserSave {
  if (held === was) {
    held = stamp === null ? null : { handle, stamp, epoch };
    if (stamp === null) openedName = { name: handle.name, epoch };
    shown(handle.name);
  }
  return stamp === null ? { kind: "saved", name: handle.name, unverified: true } : { kind: "saved", name: handle.name };
}

/** Save As: ask the user for a file, write it, keep the handle. */
export async function saveAsPicked(content: string, projectName?: string | null, docEpoch?: number): Promise<BrowserSave> {
  const pick = picker();
  if (!pick) return { kind: "failed", reason: "this browser cannot pick a save location" };
  let handle: FsHandle;
  const was = held;
  const epoch = docEpoch ?? liveEpoch(); // the epoch the CONTENT was serialized under, when the caller knows it
  try {
    handle = await pick({
      suggestedName: defaultSaveName(projectName),
      types: [{ description: "Quantized workspace", accept: { "application/json": [".dwk"] } }],
    });
  } catch (e) {
    return errName(e) === "AbortError" ? { kind: "cancelled" } : { kind: "failed", reason: errMsg(e) };
  }
  try {
    return keep(handle, await writeThrough(handle, content), epoch, was);
  } catch (e) {
    if (held === was) held = null;
    return { kind: "failed", reason: errMsg(e) };
  }
}

/** Is the kept file still safe to overwrite? null = yes. Otherwise the outcome to
 *  report: "stale" (handle dropped, the caller re-prompts) or "failed" (handle kept,
 *  retry). Run it BEFORE serializing, while the key press's user gesture is fresh. */
export async function checkHandle(): Promise<Extract<BrowserSave, { kind: "stale" | "failed" }> | null> {
  const cur = held;
  if (!cur) return { kind: "stale", reason: "no file chosen yet" };
  const { handle } = cur;
  const drop = (reason: string, keepName = true): { kind: "stale"; reason: string } => {
    held = null;
    if (keepName) openedName = { name: handle.name, epoch: cur.epoch }; // the next download / suggestion keeps the user's name
    return { kind: "stale", reason };
  };
  // A different document (Open, restore, Remove all, or an undo across one): never write it
  // into this file. Undoing back to the saved document makes the epochs match again.
  if (cur.epoch !== useApp.getState().docEpoch) return drop(`the workspace changed since ${handle.name} was chosen`, false);
  try {
    let perm = (await handle.queryPermission?.({ mode: "readwrite" })) ?? "granted";
    if (perm !== "granted") perm = (await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied";
    if (perm !== "granted") return drop(`permission to write ${handle.name} was revoked`);
  } catch {
    // A thrown request is usually an expired gesture: keep the handle, retry next press.
    return { kind: "failed", reason: "the browser could not confirm write permission; press Ctrl+S again" };
  }
  let now: string;
  try {
    now = stampOf(await handle.getFile());
  } catch {
    return drop(`${handle.name} was moved or deleted`);
  }
  return now === cur.stamp ? null : drop(`${handle.name} was changed outside Quantized`);
}

/** Ctrl+S: overwrite the kept file if, and only if, it is still ours. */
export async function saveInPlace(content: string): Promise<BrowserSave> {
  const bad = await checkHandle();
  if (bad) return bad;
  const was = held as Held;
  const { handle, epoch } = was;
  try {
    return keep(handle, await writeThrough(handle, content), epoch, was);
  } catch (e) {
    return { kind: "failed", reason: errMsg(e) };
  }
}
