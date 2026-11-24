// The Stage view tabs' right-click menu (UX menus audit N9): Plot / Map /
// Worksheet / Workflow gave the browser's own menu. Show this view, and for
// the worksheet a floating copy (the Window menu's "Open worksheet in window").
// Provisional, owner to confirm: the Map tab's window path depends on the
// window layout, so it stays on Window > Open map in window.

import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { useApp } from "../../store/useApp";

export interface StageTabMenuProps {
  x: number;
  y: number;
  tabId: string;
  label: string;
  selected: boolean;
  onShow: () => void;
  onClose: () => void;
}

export default function StageTabMenu({ x, y, tabId, label, selected, onShow, onClose }: StageTabMenuProps) {
  const activeId = useApp((s) => s.activeId);
  const createDocumentWindow = useApp((s) => s.createDocumentWindow);
  const focusWindow = useApp((s) => s.focusWindow);
  const setStageTab = useApp((s) => s.setStageTab);
  const items: ContextMenuItem[] = [
    { label: `Show ${label}`, run: onShow, disabled: selected, title: selected ? "Already shown." : undefined },
  ];
  if (tabId === "worksheet") {
    items.push({
      label: "Open worksheet in window",
      disabled: !activeId,
      title: activeId ? undefined : "Import or select a dataset first.",
      run: () => {
        if (!activeId) return;
        focusWindow(createDocumentWindow("worksheet", activeId));
        setStageTab("plot");
      },
    });
  }
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
