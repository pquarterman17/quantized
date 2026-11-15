// Browser (no desktop bridge) sink for Save / Save As — audit-6 lane O. Only the
// SINK lives here; serialization stays in workspaceIO. Lazy chunk: loaded on
// the first browser save, so the File System Access code costs no eager bytes.
//
// Contract with `workspaceIO`: each save function returns true when it fully
// handled the save (saved, cancelled, or reported a failure) and false to mean
// "use the download fallback" (no picker in this browser, or the picker was
// refused for lack of a user gesture).

import { canPickSaveFile, defaultSaveName, saveAsPicked, saveInPlace, type BrowserSave } from "../lib/browserFileHandle";
import { saveBlob } from "../lib/download";
import { toast } from "./toasts";

interface Report {
  setStatus: (s: string) => void;
  saved: (name: string) => string;
}

function report(r: BrowserSave, io: Report): boolean {
  if (r.kind === "cancelled") return true;
  if (r.kind === "saved") {
    const msg = io.saved(r.name);
    io.setStatus(msg);
    toast(msg, "ok");
    return true;
  }
  if (r.kind === "failed") {
    const msg = `save failed — ${r.reason}; nothing was overwritten`;
    io.setStatus(msg);
    toast(msg, "danger");
    return true;
  }
  return false;
}

/** Save As in a browser tab: the picker where there is one. false = download. */
export async function browserSaveAs(content: string, projectName: string | null, io: Report): Promise<boolean> {
  if (!canPickSaveFile()) return false;
  const r = await saveAsPicked(content, projectName);
  // A refused picker (the gesture expired while the workspace serialized) must
  // still save: fall through to the download rather than lose the save.
  return r.kind === "failed" && /user activation|gesture/i.test(r.reason) ? false : report(r, io);
}

/** Ctrl+S in a browser tab holding a handle. A revoked / moved / externally
 *  changed file is NEVER overwritten: say why and re-prompt with the picker. */
export async function browserSaveInPlace(content: string, projectName: string | null, io: Report): Promise<boolean> {
  const r = await saveInPlace(content);
  if (r.kind !== "stale") return report(r, io);
  const msg = `${r.reason} — choose where to save`;
  io.setStatus(msg);
  toast(msg, "danger");
  return browserSaveAs(content, projectName, io);
}

/** The download fallback, named after the opened / saved file. */
export function browserDownload(content: string, projectName: string | null): void {
  saveBlob(new Blob([content], { type: "application/json" }), defaultSaveName(projectName));
}
