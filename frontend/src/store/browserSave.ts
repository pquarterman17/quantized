// Browser (no desktop bridge) sink for Save / Save As — audit-6 lane O. Only the
// SINK lives here; serialization stays in workspaceIO. Lazy chunk: loaded on
// the first browser save, so the File System Access code costs no eager bytes.
//
// `browserSaveAs` returns true when it fully handled the save (saved, cancelled,
// or reported a failure) and false to mean "use the download fallback" (no picker
// in this browser, or the picker was refused for lack of a user gesture).

import {
  canPickSaveFile,
  checkHandle,
  defaultSaveName,
  hasSaveHandle,
  saveAsPicked,
  saveInPlace,
  type BrowserSave,
} from "../lib/browserFileHandle";
import { saveBlob } from "../lib/download";
import { toast } from "./toasts";

interface Report {
  setStatus: (s: string) => void;
  saved: (name: string) => string;
  /** The live workspace now matches the chosen file. */
  clean: () => void;
}

function say(io: Report, msg: string, kind: "ok" | "danger"): void {
  io.setStatus(msg);
  toast(msg, kind);
}

function report(r: BrowserSave, io: Report): boolean {
  if (r.kind === "cancelled") return true;
  if (r.kind === "saved") {
    io.clean();
    const tail = r.unverified ? " — the file could not be re-read to verify it, so the next save will ask where" : "";
    say(io, io.saved(r.name) + tail, "ok");
    return true;
  }
  if (r.kind === "failed") {
    say(io, `save failed — ${r.reason}; the previous file was not replaced`, "danger");
    return true;
  }
  return false;
}

let picking = false;

/** Save As in a browser tab: the picker where there is one. false = download. */
export async function browserSaveAs(content: string, projectName: string | null, io: Report): Promise<boolean> {
  if (!canPickSaveFile()) return false;
  if (picking) return true; // a picker is already open: ignore the repeat
  picking = true;
  try {
    const r = await saveAsPicked(content, projectName);
    // A refused picker (the gesture expired while the workspace serialized) must
    // still save: fall through to the download rather than lose the save.
    return r.kind === "failed" && /user activation|gesture/i.test(r.reason) ? false : report(r, io);
  } finally {
    picking = false;
  }
}

let busy = false;

/** Ctrl+S in a browser tab. Single-flight (a held key or a double press is one save).
 *  With a kept handle it checks permission and the file's stamp BEFORE serializing, so
 *  a revoked / moved / externally changed file is NEVER overwritten: it says why and
 *  runs `saveAs` (the picker, or the download where the picker is refused). */
export async function quickSave(
  serialize: () => Promise<string | null>,
  saveAs: () => Promise<void>,
  io: Report,
): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const bad = hasSaveHandle() ? await checkHandle() : { kind: "stale" as const, reason: "" };
    if (bad?.kind === "failed") return void report(bad, io);
    if (bad) {
      if (bad.reason && bad.reason !== "no file chosen yet") toast(`${bad.reason} — choose where to save`, "danger");
      return await saveAs();
    }
    const content = await serialize();
    if (content === null) return;
    const r = await saveInPlace(content);
    if (r.kind !== "stale") return void report(r, io);
    // The file or the workspace changed while it was serializing: write nothing (the
    // content is from the old state) and let the next press start clean.
    say(io, `${r.reason} while saving; nothing was written. Press Ctrl+S again`, "danger");
  } finally {
    busy = false;
  }
}

/** The download fallback, named after the opened / saved file. */
export function browserDownload(content: string, projectName: string | null): void {
  saveBlob(new Blob([content], { type: "application/json" }), defaultSaveName(projectName));
}
