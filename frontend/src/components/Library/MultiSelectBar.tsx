// Compact multi-select action bar (GUI_INTERACTION_PLAN #13 sub-item 3):
// "N selected · Plot · Move · Tag · Export · Clear", shown at the top of the
// Library panel whenever >=2 rows are selected. Every action reuses an
// EXISTING bulk operation — nothing here is a new primitive:
//   - Plot    -> createPanelWindow(ids, "overlay") + focusWindow, the SAME
//                "Overlay in one plot" quick pick DatasetRow's context menu
//                already offers for a multi-selection (lib/panelMenu.ts).
//   - Move    -> a minimal folder-picker prompt (askParams select, same
//                pattern folderOps.runTemplateOnFolder already uses), then
//                moveDatasetToFolder per id — the same store action the
//                per-row "Move to…" menu items call. No existing standalone
//                picker component exists to reuse (checked DatasetRow's menu
//                and folderOps.ts first), so this is that "minimal dialog".
//   - Tag     -> addDatasetTag per id (the same action the row's ➕ tag chip
//                calls), after a one-field text prompt.
//   - Export  -> folderOps.exportDatasets (the folder-export core, factored
//                out so this bar doesn't need its own CSV logic).
//   - Clear   -> selectIds([]) (the same primitive selectFolderContents/
//                bulk-select already use, just emptied).

import { childFolders } from "../../lib/foldertree";
import { exportDatasets } from "./folderOps";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

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
    const add = useApp.getState().addDatasetTag;
    selectedIds.forEach((id) => add(id, tag));
    toast(`tagged ${n} dataset(s) "${tag}"`);
  };

  const onExport = () => void exportDatasets([...selectedIds], `selection-${n}.csv`, "");

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
      <button className="qz-btn" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
