// Compact multi-select action bar (GUI_INTERACTION_PLAN #13 sub-item 3):
// "N selected · Plot · Move · Tag · Export · Combine · Clear", shown at the
// top of the Library panel whenever >=2 rows are selected. Every action
// reuses an EXISTING bulk operation — nothing here is a new primitive:
//   - Plot    -> createPanelWindow(ids, "overlay") + focusWindow, the SAME
//                "Overlay in one plot" quick pick DatasetRow's context menu
//                already offers for a multi-selection
//                (lib/contextActions.ts's datasetMultiSelectActions).
//   - Move    -> a minimal folder-picker prompt (askParams select, same
//                pattern folderOps.runTemplateOnFolder already uses), then
//                moveDatasetToFolder per id — the same store action the
//                per-row "Move to…" menu items call. No existing standalone
//                picker component exists to reuse (checked DatasetRow's menu
//                and folderOps.ts first), so this is that "minimal dialog".
//   - Tag     -> batchEditDatasetMetadata (PR L, L0.56 — ONE undo entry for
//                the whole selection; the row's own ➕ tag chip still calls
//                addDatasetTag per-row, which is a single-row edit and
//                correctly gets its own entry), after a one-field text prompt.
//   - Export  -> folderOps.exportDatasets (the folder-export core, factored
//                out so this bar doesn't need its own CSV logic).
//   - Combine -> openCombineDialog (PR J slice 2, L0.32-L0.34) — the SAME
//                dialog the workbook row's "Combine…" and the row menu's
//                "Combine N selected…" (lib/combineSeparateActions.ts) open,
//                seeded with the whole bar selection; the dialog itself is
//                where the user chooses/confirms exactly which land in the
//                new workbook.
//   - Clear   -> selectIds([]) (the same primitive selectFolderContents/
//                bulk-select already use, just emptied).

import { childFolders } from "../../lib/foldertree";
import { exportDatasets } from "./folderOps";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";
import { openCombineDialog } from "../../store/combineDialog";

const ROOT = "(top level)";

export default function MultiSelectBar() {
  const selectedIds = useApp((s) => s.selectedIds);
  const n = selectedIds.length;
  if (n < 2) return null;

  const onPlot = () => {
    const s = useApp.getState();
    s.focusWindow(s.createPanelWindow([...selectedIds], "overlay"));
  };

  const onMove = async () => {
    const folders = useApp.getState().folders;
    const picked = await askParams(`Move ${n} selected to…`, [
      {
        key: "folder",
        label: "Folder",
        type: "select",
        default: ROOT,
        options: [ROOT, ...childFolders(folders, null).map((f) => f.name)],
      },
    ]);
    if (!picked) return;
    const dest = String(picked.folder);
    const target = dest === ROOT ? null : (folders.find((f) => f.name === dest)?.id ?? null);
    const move = useApp.getState().moveDatasetToFolder;
    selectedIds.forEach((id) => move(id, target));
    toast(`moved ${n} dataset(s) to ${dest === ROOT ? "top level" : `"${dest}"`}`);
  };

  const onTag = async () => {
    const picked = await askParams(`Tag ${n} selected`, [
      { key: "tag", label: "Tag", type: "text", default: "" },
    ]);
    const tag = picked ? String(picked.tag).trim() : "";
    if (!tag) return;
    // PR L (L0.56): ONE undo entry for the whole batch, not one per dataset.
    // `selectedIds`/`n` are the render-time selection, captured before this
    // async dialog resolves — a dataset can vanish while it's open
    // (adversarial-review P2), so the toast reports the store's returned
    // LIVE-applied count, never the stale `n`, and stays silent at 0.
    const updated = useApp.getState().batchEditDatasetMetadata([...selectedIds], { addTags: [tag] });
    if (updated > 0) toast(`tagged ${updated} dataset(s) "${tag}"`);
  };

  const onExport = () => void exportDatasets([...selectedIds], `selection-${n}.csv`, "");

  // PR J slice 2 (L0.32-L0.34): same discoverable-from-the-multi-selection
  // entry point as Plot/Move/Tag/Export above — the dialog itself (not this
  // bar) is where the user chooses/confirms exactly which of these land in
  // the new workbook.
  const onCombine = () => openCombineDialog({ workbookIds: [], worksheetIds: [...selectedIds] });

  const onClear = () => useApp.getState().selectIds([]);

  return (
    <div className="qzk-multiselect-bar">
      <span className="qzk-multiselect-count">{n} selected</span>
      <button className="qz-btn" onClick={onPlot}>
        Plot
      </button>
      <button className="qz-btn" onClick={() => void onMove()}>
        Move
      </button>
      <button className="qz-btn" onClick={() => void onTag()}>
        Tag
      </button>
      <button className="qz-btn" onClick={onExport}>
        Export
      </button>
      <button className="qz-btn" onClick={onCombine}>
        Combine
      </button>
      <button className="qz-btn" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
