// A failed import is reported where the user is looking (UX-C): a red toast in
// plain language, with the way forward as a button, and the technical text
// ("no parser registered for …") one click away instead of the headline.
//
// "Open import wizard" hands the failed file to the wizard (which opens with it
// already read and previewed) — only for a text-like file the wizard can read
// (`wizardCanRead`) and, for an upload, only while we still hold the File; a
// path import (desktop) opens the wizard empty. A binary container's own error
// already carries format-specific advice, so it gets Details/Copy only.

import { create } from "zustand";

import { toast, TOAST_ACTION_TTL } from "../store/toasts";
import { useApp } from "../store/useApp";
import { connectionHint, failureKind, isBinaryName, wizardCanRead } from "./importFailureHint";

/** The file the wizard should open on, set by a failed import's toast action
 *  and consumed (cleared) by the wizard on mount / on change. */
export const useWizardHandoff = create<{ file: File | null }>(() => ({ file: null }));

/** Plain-language headline: what happened to which file, no parser jargon. */
export function importFailureHeadline(name: string, technical: string): string {
  switch (failureKind(technical, name)) {
    case "server": return `Couldn't import ${name}${connectionHint(technical)}.`;
    case "missing": return `Couldn't open ${name} — it wasn't found (moved or deleted?).`;
    case "denied": return `Couldn't open ${name} — permission was denied.`;
    case "servererror": return `Couldn't import ${name} — the qz server hit an error (see Details).`;
    case "unrecognised": return `Couldn't read ${name} — the format wasn't recognised.`;
    default:
      // A binary container's own message is the format-specific advice: keep it visible.
      return isBinaryName(name)
        ? `Couldn't read ${name} — ${technical.replace(`${name}: `, "")}`
        : `Couldn't read ${name} — ${parseReason(technical)}.`;
  }
}

/** The backend's parse failure in plain words (UX audit 8 #7): the reasons a
 *  text file most often fails get named in the headline, not behind Details. */
function parseReason(technical: string): string {
  if (/file empty or only comments|\bfile is empty\b/i.test(technical)) return "the file is empty";
  if (/no data rows: the file holds only a header/i.test(technical)) return "it has a header but no data rows";
  // Ambiguous by definition: '1,500' may be 1.5 or 1500, so the headline must
  // not assert either reading (a wrong "Comma" scales the data 1000x).
  if (/could be a decimal or a thousands separator/i.test(technical)) {
    return "its commas could be decimals or thousands separators — pick the decimal separator in the import wizard";
  }
  return "the file couldn't be parsed";
}

export function toastImportFailure(
  name: string,
  technical: string,
  file?: File,
  batch?: { added: number; failed: number; total: number },
): void {
  const actions = [
    ...(wizardCanRead(name, technical)
      ? [{
          label: "Open import wizard",
          onClick: () => {
            if (file) {
              useWizardHandoff.setState({ file });
              // If the wizard never mounts (chunk failure), do not keep the File pinned.
              setTimeout(() => useWizardHandoff.getState().file === file && useWizardHandoff.setState({ file: null }), 30000);
            }
            useApp.getState().setImportWizardOpen(true);
          },
        }]
      : []),
    {
      label: "Details",
      keep: true, // the toast (and its wizard action) stays while the details show
      onClick: () => toast(technical, "info", { ttlMs: TOAST_ACTION_TTL * 2 }),
    },
    {
      label: "Copy details",
      keep: true,
      onClick: () => {
        // navigator directly: importing lib/clipboard here re-homed its TSV code into the eager chunk.
        void (navigator.clipboard?.writeText(technical) ?? Promise.reject(new Error("no clipboard"))).then(
          () => useApp.getState().setStatus("copied import details"),
          () => useApp.getState().setStatus("couldn't copy — the clipboard is unavailable"),
        );
      },
    },
  ];
  // Whether data changed: a partly-failed batch says how much of it landed.
  const failed = batch?.failed ?? 1;
  const landed = batch && batch.total > 1
    ? ` Imported ${batch.added} of ${batch.total} files${failed > 1 ? ` — ${failed} failed, showing the last` : ""}.`
    : "";
  toast(importFailureHeadline(name, technical) + landed, "danger", { actions, ttlMs: TOAST_ACTION_TTL * 2, group: FAILURE_GROUP });
}

/** Three failures fold into one toast (Toaster.tsx), not a tall column. */
const FAILURE_GROUP = { key: "import-failure", summary: (n: number) => `${n} files couldn't be read` };
