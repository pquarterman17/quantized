// The Library panel's background right-click menu (UX menus audit N9): a
// right-click on empty Library space or the header offered the browser's own
// menu. Origin and JMP offer New folder / Import there. Rows, folders and
// artifacts open their own menus first (they preventDefault), so this only
// answers what is left over; text fields keep the native menu.

import { useState, type MouseEvent, type ReactNode } from "react";

import { lazyRegion } from "../../lib/lazyRegion";

const LibraryBackgroundMenu = lazyRegion(() => import("./LibraryBackgroundMenu"), "Library menu");

export function useLibraryBackgroundMenu(onNewFolder: () => void, onImport: () => void): {
  onContextMenu: (e: MouseEvent) => void;
  node: ReactNode;
} {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: MouseEvent): void => {
    if (e.defaultPrevented || (e.target as Element).closest("input, textarea, select, button")) return;
    e.preventDefault();
    setAt({ x: e.clientX, y: e.clientY });
  };
  const node = at ? <LibraryBackgroundMenu x={at.x} y={at.y} onNewFolder={onNewFolder} onImport={onImport} onClose={() => setAt(null)} /> : null;
  return { onContextMenu, node };
}
