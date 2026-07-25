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

export async function exportActive(
  s: StoreGet,
  fn: (stem: string, ds: ReturnType<StoreGet>["datasets"][number]) => Promise<void>,
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
  try {
    const ds = await s().resolveDataset(found.id);
    if (!ds) return;
    const stem = ds.name.replace(/\.[^.]+$/, "");
    await fn(stem, ds);
    toast(`${past} ${stem}`, "ok");
  } catch (e: unknown) {
    const msg = `${verb} failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
