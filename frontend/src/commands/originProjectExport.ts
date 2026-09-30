// File ▸ Export Origin project (.opj)… body, loaded on click (fileCommands.ts
// imports it dynamically). Writes the Library's datasets into one native
// Origin project through /api/export/opj: a multi-selection exports just
// those, otherwise every loaded dataset. Each becomes a workbook named as the
// Library shows it (extension stripped).
//
// What the .opj carries is the data the writer takes: x plus value columns
// with their labels and units, per workbook. No graph, axis, colour or
// excluded-row state travels; the writer has no field for it.

import { exportOriginProject } from "../lib/api/originProject";
import { stemFromName, type StoreGet } from "../lib/exportActive";
import { runCancellable } from "../store/pendingOps";
import { toast } from "../store/toasts";

export async function runExportOriginProject(s: StoreGet): Promise<void> {
  const all = s().datasets;
  const picked = s().selectedIds.length > 1 ? all.filter((d) => s().selectedIds.includes(d.id)) : all;
  if (picked.length === 0) {
    s().setStatus("no datasets to export");
    return;
  }
  const books = `${picked.length} book${picked.length === 1 ? "" : "s"}`;
  try {
    const done = await runCancellable(`Exporting Origin project (${books})…`, async (signal) => {
      // #38: a lazy book may still be a preview; resolve every target first.
      const resolved = await s().resolveDatasets(picked.map((d) => d.id));
      signal.throwIfAborted();
      await exportOriginProject(
        {
          datasets: resolved.map((d) => ({ dataset: d.data, name: stemFromName(d.name) })),
          filename: "project",
        },
        signal,
      );
    });
    s().setStatus(done ? `exported Origin project (${books})` : "export cancelled");
  } catch (e: unknown) {
    const msg = `export failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
