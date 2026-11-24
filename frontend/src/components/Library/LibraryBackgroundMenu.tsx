// The Library panel's background right-click menu items (UX menus audit N9).
// Lazy, via useLibraryBackgroundMenu: ContextMenu stays out of the entry chunk.

import ContextMenu from "../overlays/ContextMenu";

export default function LibraryBackgroundMenu({ x, y, onNewFolder, onImport, onClose }: {
  x: number;
  y: number;
  onNewFolder: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu
      x={x}
      y={y}
      items={[
        { label: "New folder", run: onNewFolder },
        { label: "Import data…", run: onImport },
      ]}
      help={{ label: "the Library", query: "library items" }}
      onClose={onClose}
    />
  );
}
