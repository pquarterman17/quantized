// In-place editor for a worksheet column's header rows — Long Name, Units and
// Comments, Origin's three label rows (worksheet audit #12: none of them could
// be edited). Opens ON the header cell (double-click it, Shift+F2 from the
// cell cursor, or the column menu) as a small fixed popover so the three
// fields fit even when the header is narrow. Enter applies (one undo step,
// store/worksheetColumns.ts's setColumnHeader), Escape cancels; focus starts
// in Long Name and returns to the grid when it closes.

import { useEffect, useRef, useState } from "react";

import { columnMetaAt } from "../../../lib/columnmeta";
import type { Dataset } from "../../../lib/types";
import { setColumnHeader } from "../../../store/worksheetColumns";

export interface HeaderEditTarget {
  col: number;
  x: number;
  y: number;
}

export default function HeaderEditor({
  ds,
  target,
  xName,
  xUnit,
  onClose,
}: {
  ds: Dataset;
  target: HeaderEditTarget;
  xName: string;
  xUnit: string;
  onClose: () => void;
}) {
  const { col } = target;
  const comment = ds.columnProps?.[col]?.comment ?? columnMetaAt(ds.data, col)?.comment ?? "";
  const [label, setLabel] = useState(col < 0 ? xName : (ds.data.labels[col] ?? ""));
  const [unit, setUnit] = useState(col < 0 ? xUnit : (ds.data.units[col] ?? ""));
  const [note, setNote] = useState(comment);
  const first = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => first.current?.select(), []);
  // A click anywhere else closes it unapplied, like any popover.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  const name = col < 0 ? xName : (ds.data.labels[col] ?? `column ${col + 1}`);
  const apply = () => {
    setColumnHeader(ds.id, col, { label, unit, ...(note !== comment ? { comment: note } : {}) });
    onClose();
  };
  const field = (text: string, value: string, set: (v: string) => void, ref?: React.Ref<HTMLInputElement>) => (
    <label style={{ display: "grid", gridTemplateColumns: "84px 1fr", alignItems: "center", gap: 6 }}>
      <span>{text}</span>
      <input
        ref={ref}
        className="qz-input"
        aria-label={`${text}, ${name}`}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <div
      role="dialog"
      aria-label={`Edit header of ${name}`}
      ref={box}
      className="qzk-header-editor"
      style={{
        position: "fixed",
        left: Math.max(8, Math.min(target.x, window.innerWidth - 300)),
        top: Math.max(8, Math.min(target.y, window.innerHeight - 160)),
      }}
      onKeyDown={(e) => {
        e.stopPropagation(); // the grid's own keys must not act while typing here
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          apply();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="qzk-ds-meta">Column header — {name}</div>
      {field("Long Name", label, setLabel, first)}
      {field("Units", unit, setUnit)}
      {field("Comments", note, setNote)}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button className="qz-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="qz-btn qz-primary" onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
