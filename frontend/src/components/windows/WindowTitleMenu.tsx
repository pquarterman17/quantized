// The plot window title bar's right-click menu, moved out of
// WindowTitleButtons so it (and the `windowMenu` action registry behind it)
// loads on the first right-click instead of with every window frame — a
// bundle diet slice that paid for the figures audit's window fixes
// (2026-11-13) instead of raising the eager budget. Same items, same order,
// same help topic; WindowTitleButtons still owns WHEN it opens.

import { buildMenuItems } from "../../lib/contextActions";
import type { PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import { useWindowsStore } from "../../store/hooks/useWindowsStore";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { windowCloseAction, windowCoreActions, type WindowActionTarget } from "./windowMenu";

export default function WindowTitleMenu({
  win,
  x,
  y,
  canRebind,
  onClose,
}: {
  win: PlotWindow;
  x: number;
  y: number;
  /** The ⇄ button's own eligibility, so both paths offer the same rebinds. */
  canRebind: boolean;
  onClose: () => void;
}) {
  const datasets = useApp((s) => s.datasets);
  const rebindWindow = useWindowsStore((s) => s.rebindWindow);
  const target: WindowActionTarget = { win };
  const items: ContextMenuItem[] = [
    ...buildMenuItems(windowCoreActions, target),
    ...(canRebind
      ? ([
          { separator: true },
          {
            label: "Rebind to",
            submenu: datasets.map((d) => ({
              label: d.name,
              run: () => rebindWindow(win.id, d.id),
              disabled: d.id === win.datasetId,
            })),
          },
        ] as ContextMenuItem[])
      : []),
    { separator: true },
    ...buildMenuItems([windowCloseAction], target),
  ];
  return <ContextMenu x={x} y={y} items={items} help={{ label: "plot windows", query: "plot window" }} onClose={onClose} />;
}
