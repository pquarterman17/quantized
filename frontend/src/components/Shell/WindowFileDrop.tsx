// Window-wide OS file drop. Without it a file dropped anywhere but the narrow
// Library column made the browser NAVIGATE to the file, abandoning the app.
// Listens on `document` for file drags only (dataset / channel drags carry no
// "Files" type and keep their own routes), always cancels the default, and
// routes a drop through the same `importFiles` the Library uses. A closer
// handler that already took the drop (Library calls preventDefault) is not
// imported twice. The overlay text lives in a lazy chunk.

import { lazy, Suspense, useEffect, useState } from "react";

import { useApp } from "../../store/useApp";

const Overlay = lazy(() => import("./FileDropOverlay"));

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes("Files");

export default function WindowFileDrop() {
  const importFiles = useApp((s) => s.importFiles);
  const [count, setCount] = useState(0); // >0 while a file drag is over the window
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setCount(Math.max(1, e.dataTransfer?.items.length ?? 1));
    };
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e) || --depth > 0) return;
      depth = 0;
      setCount(0);
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      const taken = e.defaultPrevented;
      e.preventDefault();
      depth = 0;
      setCount(0);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!taken && files.length) void importFiles(files);
    };
    const reset = (): void => {
      depth = 0;
      setCount(0);
    };
    const on: [string, (e: DragEvent) => void][] = [["dragenter", enter], ["dragover", over], ["dragleave", leave], ["drop", drop], ["dragend", reset]];
    for (const [t, f] of on) document.addEventListener(t, f as EventListener);
    return () => { for (const [t, f] of on) document.removeEventListener(t, f as EventListener); };
  }, [importFiles]);
  return count > 0 ? <Suspense fallback={null}><Overlay count={count} /></Suspense> : null;
}
