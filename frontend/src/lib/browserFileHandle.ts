// Browser "Save in place" through the File System Access API (audit-6 lane O,
// P11/B9). A plain browser tab cannot learn a durable path, so before this
// module every Save downloaded a fresh `workspace.dwk`. Where the API exists
// (Chromium), the first Save As picks a file handle and keeps it, and every
// later Ctrl+S overwrites THAT file. Firefox / Safari have no
// `showSaveFilePicker`: callers fall back to the download, unchanged.
//
// Pure of the store (a lazy chunk; `store/browserSave.ts` is the orchestrator).
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
  | { kind: "saved"; name: string }
  | { kind: "cancelled" }
  | { kind: "stale"; reason: string }
  | { kind: "failed"; reason: string };

let held: { handle: FsHandle; stamp: string } | null = null;
let openedName: string | null = null;

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
  const base = held?.handle.name ?? openedName ?? projectName ?? "workspace";
  return /\.(dwk|json)$/i.test(base) ? base : `${base}.dwk`;
}

/** A browser Open really replaced the workspace with `name`'s file: any kept
 *  handle names the OLD file, so it is dropped, and `name` is adopted for the
 *  next download / Save As suggestion. */
export function commitOpened(name?: string): void {
  held = null;
  openedName = name ?? null;
}

/** Test seam: forget everything. */
export function resetBrowserFile(): void {
  held = null;
  openedName = null;
}

async function writeThrough(handle: FsHandle, content: string): Promise<string> {
  const w = await handle.createWritable();
  try {
    await w.write(content);
    await w.close();
  } catch (e) {
    await w.abort?.().catch(() => undefined);
    throw e;
  }
  return stampOf(await handle.getFile());
}

/** Save As: ask the user for a file, write it, keep the handle. */
export async function saveAsPicked(content: string, projectName?: string | null): Promise<BrowserSave> {
  const pick = picker();
  if (!pick) return { kind: "failed", reason: "this browser cannot pick a save location" };
  let handle: FsHandle;
  try {
    handle = await pick({
      suggestedName: defaultSaveName(projectName),
      types: [{ description: "Quantized workspace", accept: { "application/json": [".dwk"] } }],
    });
  } catch (e) {
    return errName(e) === "AbortError" ? { kind: "cancelled" } : { kind: "failed", reason: errMsg(e) };
  }
  try {
    held = { handle, stamp: await writeThrough(handle, content) };
    return { kind: "saved", name: handle.name };
  } catch (e) {
    held = null;
    return { kind: "failed", reason: errMsg(e) };
  }
}

/** Ctrl+S: overwrite the kept file if, and only if, it is still ours. */
export async function saveInPlace(content: string): Promise<BrowserSave> {
  const cur = held;
  if (!cur) return { kind: "stale", reason: "no file chosen yet" };
  const { handle } = cur;
  const drop = (reason: string): BrowserSave => {
    held = null;
    return { kind: "stale", reason };
  };
  try {
    let perm = (await handle.queryPermission?.({ mode: "readwrite" })) ?? "granted";
    if (perm !== "granted") perm = (await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied";
    if (perm !== "granted") return drop(`permission to write ${handle.name} was revoked`);
  } catch {
    return drop(`permission to write ${handle.name} could not be confirmed`);
  }
  let now: string;
  try {
    now = stampOf(await handle.getFile());
  } catch {
    return drop(`${handle.name} was moved or deleted`);
  }
  if (now !== cur.stamp) return drop(`${handle.name} was changed outside Quantized`);
  try {
    held = { handle, stamp: await writeThrough(handle, content) };
    return { kind: "saved", name: handle.name };
  } catch (e) {
    return { kind: "failed", reason: errMsg(e) };
  }
}
