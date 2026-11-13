// The notice for a lazy Origin book whose uploaded project the server no
// longer holds (`routes/books.py`'s 404 "upload expired"). Loaded on demand by
// `store/pendingEdit.announceBookFailure`, so its wording and state stay out
// of the eager bundle.
//
// ONE CAUSE, ONE TOAST — WHILE IT IS ON SCREEN. Every book of an uploaded
// project shares its upload token, and a restored workspace can kick several
// at once (views, the worksheet, a queued action), each a separate fetch with
// its own rejection: the audit (2026-11) saw three toasts for one cause. So a
// token is not announced again while its toast is still showing. The scope is
// the toast's LIFETIME, not the session: once it has timed out or been
// dismissed, the next failed attempt — a click on another book, a retried
// action — shows the notice and its Re-import action again. (The first cut
// suppressed it for the rest of the session, leaving later attempts with no
// visible recovery.)

import type { Dataset } from "../lib/types";
import { toast, useToasts, type ToastOptions } from "./toasts";

/** Upload token -> the id of the toast currently announcing its expiry. */
const showing = new Map<string, number>();

export function announceExpiredUpload(ds: Dataset, offer: ToastOptions): void {
  const token = ds.pending?.token ?? "";
  const msg =
    `The uploaded Origin project behind "${ds.name}" is no longer in the server's upload cache, ` +
    "so its books can't load. Re-import the file to continue.";
  let live: { id: number; msg: string }[] = [];
  try {
    live = useToasts.getState().toasts;
  } catch {
    // A suite that mocks ./toasts with `toast` alone: no store to consult.
  }
  const shown = showing.get(token);
  if (shown !== undefined && live.some((t) => t.id === shown)) return;
  toast(msg, "danger", offer);
  try {
    const mine = [...useToasts.getState().toasts].reverse().find((t) => t.msg === msg);
    if (mine) showing.set(token, mine.id);
  } catch {
    showing.delete(token);
  }
}
