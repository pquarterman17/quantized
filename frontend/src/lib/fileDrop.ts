// Shared OS-file-drop plumbing: the Library column and the window-wide
// handler (components/Shell/WindowFileDrop) both import through here, so a
// drop is imported exactly once whichever surface sees it first -- and no
// other drop target (figure-page slots, quick-figure zones, plot frames, ...)
// can swallow it by calling preventDefault on an event it does not understand.

import { useState, type DragEvent as ReactDragEvent } from "react";

/** The drag carries OS files (dataset / channel / panel drags never do). */
export const isFileDrag = (dt: DataTransfer | null | undefined): boolean => !!dt && Array.from(dt.types).includes("Files");

/** A link / page drag from another tab or window: no files, a URL, and none of
 *  this app's own `application/x-qz-*` payloads. Dropping it would navigate. */
export const isForeignLinkDrag = (dt: DataTransfer | null | undefined): boolean => {
  if (!dt) return false;
  const t = Array.from(dt.types);
  return t.includes("text/uri-list") && !t.includes("Files") && !t.some((x) => x.startsWith("application/x-qz"));
};

const taken = new WeakSet<Event>();

/** Import the files carried by a drop event once; later callers see it taken. */
export function importDroppedFiles(e: Event & { dataTransfer: DataTransfer | null }, importFiles: (f: File[]) => unknown): void {
  if (taken.has(e)) return;
  taken.add(e);
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) void importFiles(files);
}

/** A drop-target element's props + "a file is over me" state (Library column). */
export function useFileDropTarget(importFiles: (f: File[]) => unknown) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    props: {
      onDragOver: (e: ReactDragEvent) => {
        // Only OS file drags; an internal dataset drag (row -> folder) is
        // handled by FolderRow and must not trip the file-import dropzone.
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        if (!dragging) setDragging(true);
      },
      onDragLeave: (e: ReactDragEvent) => {
        if (e.currentTarget === e.target) setDragging(false);
      },
      onDrop: (e: ReactDragEvent) => {
        e.preventDefault();
        setDragging(false);
        importDroppedFiles(e.nativeEvent, importFiles);
      },
    },
  };
}
