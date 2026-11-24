// The right-click menu of the server-rendered aux-figure stages (UX menus
// audit N10: hexbin, KDE, Pareto, parallel, Bland-Altman, polar map). The
// preview is an <img>, so the browser offered "Save image as...", which saves
// the screen PNG and bypasses the PDF / SVG default of Export. Now the menu is
// the app's: Export figure... (the vector default) and a way back. Copy figure
// and Send to report wait for a figure payload these stages do not hold yet
// (provisional, owner to confirm). Text fields keep the native menu.

import { useState, type MouseEvent, type ReactNode } from "react";

import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";

export function useAuxFigureMenu({ problem, onExport, onBack }: {
  /** Why nothing can be drawn or exported (null: exportable). */
  problem: string | null;
  onExport: () => void;
  /** Back to the cartesian plot, when the stage offers it. */
  onBack?: () => void;
}): { onContextMenu: (e: MouseEvent) => void; node: ReactNode } {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: MouseEvent): void => {
    if ((e.target as Element).closest("input, textarea, select")) return;
    e.preventDefault();
    setAt({ x: e.clientX, y: e.clientY });
  };
  const items: ContextMenuItem[] = [
    { label: "Export figure…", run: onExport, disabled: !!problem, title: problem ?? undefined },
    ...(onBack ? [{ separator: true } as const, { label: "Back to cartesian plot", run: onBack }] : []),
  ];
  return { onContextMenu, node: at ? <ContextMenu x={at.x} y={at.y} items={items} help={{ label: "plots", query: "plot" }} onClose={() => setAt(null)} /> : null };
}
