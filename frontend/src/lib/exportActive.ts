// Shared "export the active dataset" chokepoint — every File-menu export
// command in App.tsx (CSV / HDF5 / figure / Origin) routes a target through
// here rather than reading `s().datasets` directly.
//
// #38 deferred edge (ORIGIN_FILE_DECODE_PLAN): resolves a still-pending
// (preview-only) dataset to full data FIRST, so this is the single chokepoint
// that keeps every export from silently running on the small lazy-book
// preview. A resolve failure reuses the same export-failed status/toast as
// an ordinary export failure — the operation is aborted either way, never
// falls through to the preview.
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

/** Wording for the status/toast messages. Defaults describe an export; "Copy
 *  figure" (MAIN #35) passes copy wording so it routes through this SAME lazy-
 *  resolve chokepoint instead of re-implementing the resolve and reopening the
 *  #38 preview-data bug. */
export interface ExportActiveLabels {
  /** Infinitive, used in the failure paths: "no dataset to copy". */
  verb?: string;
  /** Past tense, used on success: "copied scan". */
  past?: string;
}

/** "export" -> "Export" for the pendingOps label ("Exporting scan.dat…"). */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
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
  const opId = beginOp(`${capitalize(verb)}ing ${found.name}…`, () => controller.abort());
  try {
    const ds = await s().resolveDataset(found.id);
    // Cancelled while resolving a still-pending (lazy-book) dataset: never
    // reaches the actual export request at all.
    if (controller.signal.aborted) return;
    if (!ds) return;
    const stem = ds.name.replace(/\.[^.]+$/, "");
    await fn(stem, ds, controller.signal);
    // Race guard: `fn` resolving successfully right as Cancel lands must
    // never report success — the transport layer's own check (see this
    // module's header) makes this unreachable for postDownload/postBlob
    // callers today, but the guard is cheap and keeps that an
    // implementation detail `fn` is not required to know about.
    if (controller.signal.aborted) return;
    toast(`${past} ${stem}`, "ok");
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      s().setStatus(`${verb} cancelled`);
      return;
    }
    const msg = `${verb} failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  } finally {
    endOp(opId);
  }
}
