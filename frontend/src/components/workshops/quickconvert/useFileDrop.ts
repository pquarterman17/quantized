// Quick Convert: OS file drops on the drop zone.
//
// The full app listens for file drags on `document` (Shell/WindowFileDrop) and
// would import a file dropped here into the workspace. Native capture listeners
// on `window` run first, so a drag whose target is inside the zone is handled
// here and stopped; the standalone page has no such listener, and this behaves
// the same there. Folders are refused with a message (a browser cannot read one).

import { useEffect, useState, type RefObject } from "react";

const hasFiles = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types).includes("Files");

function folderNames(dt: DataTransfer): string[] {
  return Array.from(dt.items)
    .filter((i) => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory)
    .map((i) => i.getAsFile()?.name ?? "folder");
}

export function useFileDrop(
  zone: RefObject<HTMLElement | null>,
  onFiles: (files: File[]) => void,
  onFolders: (names: string[]) => void,
  enabled: boolean,
): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const inside = (e: DragEvent): boolean => e.target instanceof Node && !!zone.current?.contains(e.target);
    const handle = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer) || !inside(e)) {
        if (e.type === "dragleave" || e.type === "drop") setOver(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // never reaches the app's window-wide import
      if (e.dataTransfer && e.type === "dragover") e.dataTransfer.dropEffect = "copy";
      if (e.type === "dragenter" || e.type === "dragover") setOver(true);
      if (e.type === "dragleave" && e.relatedTarget instanceof Node && zone.current?.contains(e.relatedTarget)) return;
      if (e.type === "dragleave") setOver(false);
      if (e.type === "drop" && e.dataTransfer) {
        setOver(false);
        const folders = folderNames(e.dataTransfer);
        if (folders.length) onFolders(folders);
        const files = Array.from(e.dataTransfer.files).filter((f) => !folders.includes(f.name));
        if (files.length) onFiles(files);
      }
    };
    const types = ["dragenter", "dragover", "dragleave", "drop"] as const;
    for (const t of types) window.addEventListener(t, handle, true);
    return () => {
      for (const t of types) window.removeEventListener(t, handle, true);
    };
  }, [zone, onFiles, onFolders, enabled]);
  return over;
}
