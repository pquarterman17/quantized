// The 2-D map's right-click menu (UX menus audit M4). Before it, a right-click
// on the map, an axis or the colorbar opened the browser's own menu (Back /
// Reload / Inspect / Save image). The items put the map tools that live in
// five different menus (Map operations, ROI cuts, colormap, log scale,
// contour lines, range) next to Copy figure and Export figure, the family
// Origin's matrix right-click and JMP's contour menu offer. One menu for the
// whole stage; an axis / colorbar variant waits until the canvas can report
// which axis was hit (provisional, owner to confirm).

import { useState, type MouseEvent, type ReactNode } from "react";

import { lazyRegion } from "../../lib/lazyRegion";
import type { MapMenuProps } from "./MapContextMenu";

const MapContextMenu = lazyRegion(() => import("./MapContextMenu"), "Map menu");

export function useMapContextMenu(props: Omit<MapMenuProps, "x" | "y" | "onClose">): {
  onContextMenu: (e: MouseEvent) => void;
  node: ReactNode;
} {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: MouseEvent): void => {
    // Fields (the toolbar's selects, number inputs) keep the native menu.
    if ((e.target as Element).closest("input, textarea, select")) return;
    e.preventDefault();
    e.stopPropagation();
    setAt({ x: e.clientX, y: e.clientY });
  };
  return { onContextMenu, node: at ? <MapContextMenu {...props} x={at.x} y={at.y} onClose={() => setAt(null)} /> : null };
}
