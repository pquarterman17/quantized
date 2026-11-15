// The toolbar's "Columns" button: opens the Hide / Show / Freeze menu
// (./columnViewMenu.ts) and says how many columns are hidden or frozen, so a
// sheet with columns out of sight is never a silent surprise.

import { useRef, useState } from "react";

import ContextMenu from "../../overlays/ContextMenu";
import { columnViewItems, type ColumnViewControls } from "./columnViewMenu";

export default function ColumnViewButton({ controls }: { controls: ColumnViewControls }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
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
        }}
      >
        Columns{note ? ` · ${note}` : ""} ▾
      </button>
      {at && <ContextMenu x={at.x} y={at.y} help={{ label: "worksheets", query: "worksheet" }} items={columnViewItems(controls)} onClose={() => setAt(null)} />}
    </>
  );
}
