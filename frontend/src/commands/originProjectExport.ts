// File ▸ Export Origin project (.opj)… body, loaded on click (fileCommands.ts
// imports it dynamically). Writes the Library's datasets into one native
// Origin project through /api/export/opj: a multi-selection exports just
// those, otherwise every loaded dataset. Each becomes a workbook named as the
// Library shows it (extension stripped).
//
// What the .opj carries is the data the writer takes: x plus value columns
// with their labels, units, comments and designations (column_designations
// + the LIVE error bindings, via withLiveErrorRoles), per workbook. No
// graph, axis, colour or excluded-row state travels; the writer has no
// field for it.
//
// The download is named after the open project, else the single exported
// book, else "project" — never always "project.opj".

import { exportOriginProject } from "../lib/api/originProject";
import { stemFromName, type StoreGet } from "../lib/exportActive";
import { withLiveErrorRoles } from "../lib/liveErrorRoles";
import type { Dataset } from "../lib/types";
import { runCancellable } from "../store/pendingOpActions";
import { toast } from "../store/toasts";

/** The .opj file stem: the open project's name (extension stripped), else
 *  the one exported dataset's name, else "project". */
export function opjFileStem(s: StoreGet, picked: readonly Dataset[]): string {
  const project = s().currentProject?.name?.replace(/\.(dwk|json)$/i, "");
  if (project) return project;
  if (picked.length === 1) return stemFromName(picked[0].name) || "project";
  return "project";
}

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
          datasets: resolved.map((d) => ({ dataset: withLiveErrorRoles(d), name: stemFromName(d.name) })),
          filename: opjFileStem(s, picked),
        },
        signal,
      );
    });
    s().setStatus(done ? `exported Origin project (${books})` : "export cancelled");
    // Same visible confirmation the .ogs export gives (live check 2026-11:
    // the download was the only sign anything had happened).
    if (done) toast(`exported Origin project (${books})`, "ok");
  } catch (e: unknown) {
    const msg = `export failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
