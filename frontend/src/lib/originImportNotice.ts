// The one toast an Origin project import raises (store/importDatasets.ts —
// a lazy chunk, so this stays off the eager path). A file shorter than its
// own header records (backend io/origin_project/integrity.py) is announced
// as a DANGER: the books and columns past the cut are missing, and the
// import itself succeeded, so nothing else would tell the user.

import type { ToastKind, ToastOptions } from "../store/toasts";
import { originImportToast } from "./originFidelity";
import type { OriginFidelityManifest } from "./types";

/** How long the truncated-file warning stays up. The default toast lifetime
 *  (1.9 s) is for one-line confirmations; this is a two-sentence warning the
 *  user must read and act on, and — unlike a failed import — the status line
 *  does not repeat it (live check 2026-11: it was gone before it could be read). */
export const TRUNCATED_NOTICE_TTL = 12_000;

export interface OriginImportNotice {
  msg: string;
  kind: ToastKind;
  ttlMs?: number;
  /** The `toast()` options: a danger notice carries a "Show what is missing"
   *  action (when `showDetails` was given) and its own lifetime. */
  opts?: ToastOptions;
}

/** The import toast: a truncated file leads, then worksheet data that did
 *  not come in, else the graph count. `showDetails` opens the Library's
 *  Origin fidelity group (it starts tucked). */
export function originImportNotice(
  stem: string,
  fidelity: OriginFidelityManifest,
  showDetails?: () => void,
): OriginImportNotice {
  const note = baseNotice(stem, fidelity);
  if (note.kind !== "danger") return note;
  const action = showDetails ? { label: "Show what is missing", onClick: showDetails } : undefined;
  return { ...note, opts: { ttlMs: note.ttlMs, action } };
}

function baseNotice(
  stem: string,
  fidelity: OriginFidelityManifest,
): { msg: string; kind: ToastKind; ttlMs?: number } {
  const integrity = fidelity.container_integrity;
  if (fidelity.omissions.includes("file_truncated")) {
    const sizes =
      integrity?.declared_bytes != null
        ? ` (${integrity.file_bytes} of ${integrity.declared_bytes} bytes)`
        : "";
    return {
      msg:
        `${stem}: the file appears incomplete or truncated${sizes} — books and columns past ` +
        "the cut are missing. Re-copy or re-download the project and import it again.",
      kind: "danger",
      ttlMs: TRUNCATED_NOTICE_TTL,
    };
  }
  // Not truncated: worksheet data that did not come in leads (`.opju`
  // worksheet summary, a danger), else the plain graph count.
  return originImportToast(stem, fidelity);
}
