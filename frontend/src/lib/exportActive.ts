// Shared "export the active dataset" chokepoint — every File-menu export
// command in App.tsx (CSV / HDF5 / figure / Origin) routes a target through
// here rather than reading `s().datasets` directly.
//
// #38 deferred edge (ORIGIN_FILE_DECODE_PLAN): resolves a still-pending
// (preview-only) dataset to full data FIRST, so this is the single chokepoint
// that keeps every export from silently running on the small lazy-book
// preview. A resolve failure — whether resolveDataset REJECTS or resolves to
// `undefined` (the dataset vanished from the store mid-resolve) — reports the
// same export-failed status/toast an ordinary export failure would; the
// operation is aborted either way, never falls through to the preview.
//
// PRIMARY_SOFTWARE_AUDIT_PLAN P3.4 (safe cancel for long export operations):
// this is also the ONE place every export/copy that goes through it gets a
// cancel affordance, mirroring store/importDatasets.ts's `runImport` — the
// established pattern (see that module's own doc): one AbortController per
// call, registered with `pendingOps` so StatusBar renders the same Cancel
// button import batches get, and `controller.signal.aborted` (never the
// shape of a caught error) is what decides "this was a cancel" below, so it
// is robust to whatever `fn` happens to throw.
//
// Cancel semantics (the honest contract, since the backend render routes are
// synchronous `def`s with no `Request`/disconnect check — see
// `routes/export*.py` — so the server keeps rendering to completion either
// way): cancel means "stop waiting and discard the result", not "stop the
// server". No download/clipboard write happens for a cancelled export — the
// blob-producing transport (`postDownload`/`postBlob`, lib/api/http.ts)
// re-checks the SAME signal right before writing, closing the race where the
// response already landed when Cancel is clicked.

import { beginOp, endOp } from "../store/pendingOps";
import { toast } from "../store/toasts";
import type { useApp } from "../store/useApp";

export type StoreGet = typeof useApp.getState;

/** N5 (2026-09-13 round-2 review): every caller in the repo passes exactly
 *  one of these two verbs — narrowed from a bare `string` so a third one
 *  (e.g. a future "save"/"move") is a compile error here, at the one place
 *  that decides wording, instead of a silent runtime fallback nobody
 *  reviews. */
export type ExportActiveVerb = "export" | "copy";

/** Wording for the status/toast messages. Defaults describe an export; "Copy
 *  figure" (MAIN #35) passes copy wording so it routes through this SAME lazy-
 *  resolve chokepoint instead of re-implementing the resolve and reopening the
 *  #38 preview-data bug. */
export interface ExportActiveLabels {
  /** Infinitive, used in the failure paths: "no dataset to copy". */
  verb?: ExportActiveVerb;
  /** Past tense, used on success: "copied scan". */
  past?: string;
}

/** verb -> its pendingOps-label gerund. A closed, two-entry map now that
 *  `verb` is a union type — no naive `${capitalize(verb)}ing` fallback to
 *  keep honest for an unlisted verb, since there is no longer any way to
 *  reach one. */
const GERUND: Record<ExportActiveVerb, string> = { export: "Exporting", copy: "Copying" };
function gerund(verb: ExportActiveVerb): string {
  return GERUND[verb];
}

/** Report a cancellation the same way at every point it can land — set the
 *  status line so Cancel is never a silent no-op. Used at every early return
 *  below once `controller.signal.aborted` is true: previously only the
 *  catch-block's cancel path set this, so a cancel that landed WHILE
 *  resolving a still-pending (lazy-book) dataset — the longest window, since
 *  that resolve can be a real network fetch — vanished with no status, no
 *  toast, and no visible sign the click did anything. No toast here on
 *  purpose: a user-initiated cancel is an expected outcome, not a failure
 *  worth interrupting them over — the status line (same wording the
 *  catch-block already used) is enough. */
export function cancelled(s: StoreGet, verb: string): void {
  s().setStatus(`${verb} cancelled`);
}

export async function exportActive(
  s: StoreGet,
  fn: (
    stem: string,
    ds: ReturnType<StoreGet>["datasets"][number],
    signal: AbortSignal,
  ) => Promise<void>,
  labels: ExportActiveLabels = {},
): Promise<void> {
  const verb = labels.verb ?? "export";
  const past = labels.past ?? "exported";
  const found = s().datasets.find((d) => d.id === s().activeId);
  if (!found) {
    s().setStatus(`no dataset to ${verb}`);
    toast(`no dataset to ${verb}`, "danger");
    return;
  }
  const controller = new AbortController();
  const opId = beginOp(`${gerund(verb)} ${found.name}…`, () => controller.abort());
  try {
    const ds = await s().resolveDataset(found.id);
    // Cancelled while resolving a still-pending (lazy-book) dataset: never
    // reaches the actual export request at all.
    if (controller.signal.aborted) {
      cancelled(s, verb);
      return;
    }
    // F4 (2026-09-13 round-2 review): resolveDataset can resolve to
    // `undefined` WITHOUT throwing (the dataset vanished from the store
    // mid-resolve) — a bare early return here used to be silent: no status,
    // no toast, op just cleared. Reuse the same export-failed shape the
    // catch block below reports for a resolve that actually throws (see
    // this module's header).
    if (!ds) {
      const msg = `${verb} failed: dataset is no longer available`;
      s().setStatus(msg);
      toast(msg, "danger");
      return;
    }
    const stem = ds.name.replace(/\.[^.]+$/, "");
    await fn(stem, ds, controller.signal);
    // Race guard: `fn` resolving successfully right as Cancel lands.
    if (controller.signal.aborted) {
      // For a download (postDownload's throwIfAborted + synchronous
      // saveBlob, no `await` between) this is unreachable — the transport
      // itself would have rejected instead of resolving. For a clipboard
      // copy it IS reachable (F1, 2026-09-13 round-2 review): `fn` resolving
      // here means copyImageAsync/copySvgAsync already returned `true`,
      // which only happens after `navigator.clipboard.write(...)` itself
      // resolved — the write is DONE, not "maybe still racing". Reporting
      // "copy cancelled" at that point would be a lie: the figure is
      // already sitting on the user's clipboard. Report what actually
      // happened instead of the generic cancelled status.
      if (verb === "copy") {
        const msg = `${past} ${stem} — cancel arrived too late to stop it`;
        s().setStatus(msg);
        toast(msg, "ok");
        return;
      }
      cancelled(s, verb);
      return;
    }
    toast(`${past} ${stem}`, "ok");
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      cancelled(s, verb);
      return;
    }
    const msg = `${verb} failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  } finally {
    endOp(opId);
  }
}
