// The toolbar's "Columns" button: opens the Hide / Show / Freeze menu
// (./columnViewMenu.ts) and says how many columns are hidden or frozen, so a
// sheet with columns out of sight is never a silent surprise.

import { useRef, useState } from "react";

import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";
import { columnViewItems, type ColumnViewControls } from "./columnViewMenu";

export default function ColumnViewButton({ controls }: { controls: ColumnViewControls }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [sheetItems, setSheetItems] = useState<ContextMenuItem[]>([]);
  const { hidden, frozen } = controls;
  const note = [hidden.length ? `${hidden.length} hidden` : "", frozen ? `${frozen} frozen` : ""].filter(Boolean).join(" · ");
  return (
    <>
      <button
        ref={ref}
        className={note ? "qz-btn qz-active" : "qz-btn"}
        aria-haspopup="menu"
        title="Hide, show and freeze worksheet columns (view only — hidden columns can still be plotted)"
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          setAt({ x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4 });
          const sheet = controls.sheet;
          setSheetItems([]); // never a stale Protect / Unprotect label from the last open
          // The worksheet-level entries come from a lazy chunk: the menu opens at once and gains them when it lands.
          if (sheet) void runLazy("Loading the sheet menu…", () => import("./sheetViewItems")).then((m) => setSheetItems(m.sheetViewItems(sheet)), onLoadFailure);
        }}
      >
        Columns{note ? ` · ${note}` : ""} ▾
      </button>
      {at && <ContextMenu x={at.x} y={at.y} help={{ label: "worksheets", query: "worksheet" }} items={[...columnViewItems(controls), ...sheetItems]} onClose={() => setAt(null)} />}
    </>
  );
}
