// A finished Select rows box on one panel, applied: the sheet rows it names (lib/panelBoxRows.ts) become the row
// selection through the row-state model, as the single plot's box does, or the reason it cannot is toasted. Loaded on
// demand from Stage/usePanelBoxSelect.ts.

import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { panelBoxRows, type PanelBoxPick } from "./panelBoxRows";

export function applyPanelBox(
  panel: Parameters<typeof panelBoxRows>[0],
  args: { view: Parameters<typeof panelBoxRows>[1]; xKey: number | null; offset: number; hidden: readonly number[]; label: string },
  pick: PanelBoxPick,
): void {
  const rows = panelBoxRows(panel, args.view, args.xKey, args.offset, pick, args.hidden);
  if (typeof rows === "string") return void toast(`couldn't select those points: ${rows}`, "danger");
  const st = useApp.getState();
  st.setRowSelection(rows);
  st.setStatus(`selected ${rows.length} row${rows.length === 1 ? "" : "s"} in panel ${args.label}`);
}
