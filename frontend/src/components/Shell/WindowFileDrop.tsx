// Window-wide OS file drop. Without it a file dropped anywhere but the narrow
// Library column made the browser NAVIGATE to the file, abandoning the app.
// Listens on `document`: file drags are always cancelled (so the browser never
// navigates) and imported through lib/fileDrop -- the SAME path the Library
// uses, which marks a drop as taken so it is never imported twice. No other
// drop target can swallow a file drop (a slot grid or zone that cancels an
// event it does not understand no longer matters). A link dragged in from
// another page is cancelled too and ignored. Dataset / channel drags carry no
// "Files" type and keep their own routes. The overlay lives in a lazy chunk.

import { lazy, Suspense, useEffect, useState } from "react";

import { importDroppedFiles, isFileDrag, isForeignLinkDrag } from "../../lib/fileDrop";
import { useApp } from "../../store/useApp";

const Overlay = lazy(() => import("./FileDropOverlay"));

export default function WindowFileDrop() {
  const importFiles = useApp((s) => s.importFiles);
  const [count, setCount] = useState(0); // >0 while a file drag is over the window
  useEffect(() => {
    let depth = 0;
    let stale: ReturnType<typeof setTimeout> | undefined;
    const hide = (): void => {
      depth = 0;
      clearTimeout(stale);
      setCount(0);
    };
    // Browsers re-fire dragover while a drag is over the page; silence for this
    // long means the drag ended without a dragleave (an element was removed).
    const arm = (): void => {
      clearTimeout(stale);
      stale = setTimeout(hide, 1500);
    };
    const enter = (e: DragEvent): void => {
      if (isForeignLinkDrag(e.dataTransfer)) return void e.preventDefault();
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth++;
      arm();
      setCount(Math.max(1, e.dataTransfer?.items.length ?? 1));
    };
    const over = (e: DragEvent): void => {
      if (!isFileDrag(e.dataTransfer) && !isForeignLinkDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (isFileDrag(e.dataTransfer)) arm();
      if (e.dataTransfer) e.dataTransfer.dropEffect = isFileDrag(e.dataTransfer) ? "copy" : "none";
    };
    const leave = (e: DragEvent): void => {
      if (!isFileDrag(e.dataTransfer)) return;
      // Pointer left the window (no target entered, coordinates at/past the
      // edge): clears a depth count left high by an element removed mid-drag.
      const out = e.relatedTarget === null && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight);
      if (out || --depth <= 0) hide();
    };
    const drop = (e: DragEvent): void => {
      if (isForeignLinkDrag(e.dataTransfer)) return void e.preventDefault();
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      hide();
      importDroppedFiles(e, importFiles);
    };
    const on: [string, (e: DragEvent) => void][] = [["dragenter", enter], ["dragover", over], ["dragleave", leave], ["drop", drop], ["dragend", hide]];
    for (const [t, f] of on) document.addEventListener(t, f as EventListener);
    return () => {
      clearTimeout(stale);
      for (const [t, f] of on) document.removeEventListener(t, f as EventListener);
    };
  }, [importFiles]);
  return count > 0 ? <Suspense fallback={null}><Overlay count={count} /></Suspense> : null;
}
