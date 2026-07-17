// Folder-level bulk operations (project-organization plan item 8) — module-
// level helpers the FolderRow context menu drives. Each op resolves the
// folder's WHOLE subtree of datasets (lib/foldertree.subtreeDatasets — tree
// render order, so exports mirror the Library) and reuses the store's existing
// bulk primitives (selectIds / applyCorrectionsToMany / removeDatasets) plus
// the shared template-run core; no new state lives here.

import { exportConsolidated } from "../../lib/api";
import { subtreeDatasets } from "../../lib/foldertree";
import {
  extractOutputs,
  loadTemplates,
  summaryDataset,
  type BatchRow,
} from "../../lib/template";
import type { Dataset, FolderNode } from "../../lib/types";
import { ACCENTS } from "../../store/prefs";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { askParams, type ParamField } from "../overlays/ParamDialog";
import { runTemplateOnDataset } from "../workshops/pipeline/runTemplate";

let _seq = 0;

/** The folder's whole-subtree datasets, in Library render order. */
export function folderContents(folderId: string): Dataset[] {
  const s = useApp.getState();
  return subtreeDatasets(s.folders, s.datasets, folderId);
}

/** Replace the multi-selection with the folder's contents (never moves the
 *  plotted dataset) — the primitive that lets every existing selection-based
 *  bulk op (merge / remove / apply-to-selected / move) work folder-wise. */
export function selectFolderContents(folder: FolderNode): void {
  const members = folderContents(folder.id);
  useApp.getState().selectIds(members.map((d) => d.id));
  useApp.getState().setStatus(`selected ${members.length} dataset(s) in "${folder.name}"`);
}

/** Folder Properties dialog (plan #13 sub-item 4): name/notes/colour, plus a
 *  default analysis template WHEN any are saved (`loadTemplates` — omitted
 *  entirely otherwise, matching the same gate `runTemplateOnFolder`'s menu
 *  item already uses). Reuses the generic `askParams` prompt (same one
 *  `runTemplateOnFolder`/the smart-folder save button already use) rather
 *  than a bespoke dialog component. `renameFolder` still owns the name (it
 *  has its own blank-name guard); this only patches notes/color/
 *  defaultTemplate via the new `updateFolder` store action. */
export async function openFolderProperties(folder: FolderNode): Promise<void> {
  const templates = loadTemplates();
  const NONE = "(none)";
  const fields: ParamField[] = [
    { key: "name", label: "Name", type: "text", default: folder.name },
    { key: "notes", label: "Notes", type: "text", default: folder.notes ?? "" },
    { key: "color", label: "Colour", type: "select", default: folder.color ?? NONE, options: [NONE, ...ACCENTS] },
    ...(templates.length
      ? [
          {
            key: "defaultTemplate",
            label: "Default template",
            type: "select",
            default: folder.defaultTemplate ?? NONE,
            options: [NONE, ...templates.map((t) => t.name)],
            hint: "pre-selected by “Run analysis template on folder…”",
          } as ParamField,
        ]
      : []),
  ];
  const picked = await askParams(`Properties — "${folder.name}"`, fields);
  if (!picked) return;

  const s = useApp.getState();
  const name = String(picked.name).trim();
  if (name) s.renameFolder(folder.id, name);
  s.updateFolder(folder.id, {
    notes: String(picked.notes).trim() || undefined,
    color: picked.color === NONE ? undefined : String(picked.color),
    ...(templates.length
      ? { defaultTemplate: picked.defaultTemplate === NONE ? undefined : String(picked.defaultTemplate) }
      : {}),
  });
  toast(`updated "${name || folder.name}" properties`);
}

/** Export a specific set of datasets side-by-side as one consolidated CSV —
 *  the shared core behind `exportFolderCsv` (a folder's whole subtree) AND
 *  the multi-select bar's "Export" (an arbitrary selection, plan #13
 *  sub-item 3): same #38 resolve-pending-first + toast/status behaviour
 *  either way, just keyed by an explicit id list instead of a folder. */
export async function exportDatasets(ids: string[], filename: string, label: string): Promise<void> {
  if (ids.length === 0) return;
  try {
    // #38 deferred edge: the set very often includes datasets that were
    // never activated/rendered — resolve them all first (bounded
    // concurrency) rather than silently exporting previews.
    const resolved = await useApp.getState().resolveDatasets(ids);
    await exportConsolidated({
      datasets: resolved.map((d) => ({ dataset: d.data, name: d.name })),
      filename,
    });
    toast(`exported ${resolved.length} dataset(s)${label}`);
  } catch (e) {
    const msg = `export failed: ${e instanceof Error ? e.message : "error"}`;
    useApp.getState().setStatus(msg);
    toast(msg, "danger");
  }
}

/** Export every dataset in the folder side-by-side as one consolidated CSV. */
export async function exportFolderCsv(folder: FolderNode): Promise<void> {
  const members = folderContents(folder.id);
  await exportDatasets(
    members.map((d) => d.id),
    `${folder.name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv`,
    ` from "${folder.name}"`,
  );
}

/** Copy the ACTIVE dataset's corrections onto every dataset in the folder —
 *  each target re-derived from its own raw (applyCorrectionsToMany). */
export async function applyActiveCorrectionsToFolder(folder: FolderNode): Promise<void> {
  const s = useApp.getState();
  const src = s.datasets.find((d) => d.id === s.activeId);
  if (!src?.corrections) return; // menu item is gated on this — belt and braces
  const ids = folderContents(folder.id).map((d) => d.id);
  if (ids.length === 0) return;
  await s.applyCorrectionsToMany(src.id, ids);
  toast(`applied corrections to ${ids.length} dataset(s) in "${folder.name}"`);
}

/** Ask which saved analysis template to run, then run it over every dataset in
 *  the folder — the folder-scoped twin of the #3 file batch: per-dataset #36
 *  reports plus one summary worksheet, recording suppressed while it runs. */
export async function runTemplateOnFolder(folder: FolderNode): Promise<void> {
  const members = folderContents(folder.id);
  const templates = loadTemplates();
  if (members.length === 0 || templates.length === 0) return;
  // Folder Properties' default template (sub-item 4) pre-selects the picker
  // when it still names a template that exists; a stale/renamed name just
  // falls back to the first loaded template, same as before this existed.
  const defaultName =
    folder.defaultTemplate && templates.some((t) => t.name === folder.defaultTemplate)
      ? folder.defaultTemplate
      : templates[0].name;
  const picked = await askParams(`Run template on "${folder.name}"`, [
    {
      key: "template",
      label: "Template",
      type: "select",
      default: defaultName,
      options: templates.map((t) => t.name),
      hint: `runs on ${members.length} dataset(s)`,
    },
  ]);
  if (!picked) return; // cancelled
  const t = templates.find((x) => x.name === String(picked.template));
  if (!t) return;

  const s = useApp.getState();
  s.setPipelineRunning(true); // suppress self-recording, like the file batch
  const rows: BatchRow[] = [];
  let failures = 0;
  try {
    for (const d of members) {
      try {
        const row = await runTemplateOnDataset(t, d.id, d.name);
        rows.push(row);
        if (row.failed) failures++;
      } catch (e) {
        // One bad dataset yields a flagged row, never a dead run (#3 parity).
        rows.push({
          file: d.name,
          values: extractOutputs(t.outputs, undefined),
          failed: e instanceof Error ? e.message : "error",
        });
        failures++;
      }
    }
    useApp.getState().addDataset({
      id: `tplf-${Date.now().toString(36)}-${++_seq}`,
      name: `${t.name} — ${folder.name} (${rows.length})`,
      data: summaryDataset(t.name, t.outputs.length ? t.outputs : ["R2"], rows),
    });
    toast(
      failures
        ? `folder run done — ${failures}/${rows.length} dataset(s) flagged`
        : `folder run done — ${rows.length} dataset(s)`,
      failures ? "danger" : undefined,
    );
  } finally {
    useApp.getState().setPipelineRunning(false);
  }
}

/** DANGER: remove the folder subtree AND every dataset in it. The plain
 *  "Delete folder" only re-homes contents; this one destroys them (figure/
 *  report reference pruning rides the store's removeDatasets). */
export function removeFolderWithDatasets(folder: FolderNode): void {
  const s = useApp.getState();
  const ids = folderContents(folder.id).map((d) => d.id);
  s.removeDatasets(ids);
  s.deleteFolder(folder.id, "cascade");
  toast(`deleted "${folder.name}" and ${ids.length} dataset(s)`);
}
