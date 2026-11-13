// The one toast an Origin project import raises (store/importDatasets.ts —
// a lazy chunk, so this stays off the eager path). A file shorter than its
// own header records (backend io/origin_project/integrity.py) is announced
// as a DANGER: the books and columns past the cut are missing, and the
// import itself succeeded, so nothing else would tell the user.

import type { ToastKind } from "../store/toasts";
import type { OriginFidelityManifest } from "./types";

/** How long the truncated-file warning stays up. The default toast lifetime
 *  (1.9 s) is for one-line confirmations; this is a two-sentence warning the
 *  user must read and act on, and — unlike a failed import — the status line
 *  does not repeat it (live check 2026-11: it was gone before it could be read). */
export const TRUNCATED_NOTICE_TTL = 12_000;

export function originImportNotice(
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
  return {
    msg: `${stem}: ${fidelity.graph_records_actionable}/${fidelity.graph_records_total} Origin graph records are editable; fidelity details saved`,
    kind: "info",
  };
}
