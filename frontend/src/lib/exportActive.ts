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

export async function exportActive(
  s: StoreGet,
  fn: (stem: string, ds: ReturnType<StoreGet>["datasets"][number]) => Promise<void>,
): Promise<void> {
  const found = s().datasets.find((d) => d.id === s().activeId);
  if (!found) {
    s().setStatus("no dataset to export");
    toast("no dataset to export", "danger");
    return;
  }
  try {
    const ds = await s().resolveDataset(found.id);
    if (!ds) return;
    const stem = ds.name.replace(/\.[^.]+$/, "");
    await fn(stem, ds);
    toast(`exported ${stem}`, "ok");
  } catch (e: unknown) {
    const msg = `export failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
