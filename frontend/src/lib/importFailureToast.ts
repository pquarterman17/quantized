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
import { connectionHint, wizardCanRead } from "./importFailureHint";

/** The file the wizard should open on, set by a failed import's toast action
 *  and consumed (cleared) by the wizard on mount / on change. */
export const useWizardHandoff = create<{ file: File | null }>(() => ({ file: null }));

/** Plain-language headline: what happened to which file, no parser jargon. */
export function importFailureHeadline(name: string, technical: string): string {
  const cause = connectionHint(technical);
  if (cause) return `Couldn't import ${name}${cause}.`;
  return /no parser registered/i.test(technical)
    ? `Couldn't read ${name} — the format wasn't recognised.`
    : `Couldn't read ${name} — the file couldn't be parsed.`;
}

export function toastImportFailure(
  name: string,
  technical: string,
  file?: File,
  batch?: { added: number; total: number },
): void {
  const actions = [
    ...(wizardCanRead(name, technical)
      ? [{
          label: "Open import wizard",
          onClick: () => {
            if (file) useWizardHandoff.setState({ file });
            useApp.getState().setImportWizardOpen(true);
          },
        }]
      : []),
    {
      label: "Details",
      onClick: () => toast(technical, "info", { ttlMs: TOAST_ACTION_TTL * 2 }),
    },
    {
      label: "Copy details",
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
  const failed = batch ? batch.total - batch.added : 1;
  const landed = batch && batch.total > 1
    ? ` Imported ${batch.added} of ${batch.total} files${failed > 1 ? ` — ${failed} failed; this is the last` : ""}.`
    : "";
  toast(importFailureHeadline(name, technical) + landed, "danger", { actions, ttlMs: TOAST_ACTION_TTL * 2 });
}
