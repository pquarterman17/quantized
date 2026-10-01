// P2.6 — the level-order workshop's "Level" cell: the label, renamable in
// place by double-clicking it or the ✎ button. The rename itself is
// store/levelRename.ts (one undo entry, re-derived refusal, duplicate
// refusal); this cell only collects the text. A refused rename keeps the edit
// open so the user can fix the name. It commits straight away, independent of
// the panel's reorder draft, which is keyed by code and so unaffected.

import { useRef, useState } from "react";

import { renameLevel } from "../../../store/levelRename";

export default function LevelNameCell({
  datasetId,
  channel,
  code,
  label,
  ariaLabel,
}: {
  datasetId: string;
  channel: number;
  code: number;
  label: string;
  /** The label as screen readers should hear it (disambiguated by code when two levels share it). */
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(label);
  const done = useRef(false);

  const start = () => {
    done.current = false;
    setText(label);
    setEditing(true);
  };
  const finish = () => {
    done.current = true;
    setEditing(false);
  };
  const commit = (keepOpenOnRefusal: boolean) => {
    if (done.current) return;
    if (renameLevel(datasetId, channel, code, text) || !keepOpenOnRefusal) finish();
  };

  if (editing) {
    return (
      <input
        className="qz-input qz-sm"
        aria-label={`new name for ${ariaLabel}`}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(true);
          else if (e.key === "Escape") {
            e.stopPropagation();
            finish();
          }
        }}
        onBlur={() => commit(false)}
      />
    );
  }
  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "space-between" }}>
      <span onDoubleClick={start}>{label}</span>
      <button
        type="button"
        className="qz-btn qz-sm"
        aria-label={`rename ${ariaLabel}`}
        title="Rename this level everywhere it is shown."
        onClick={start}
      >
        ✎
      </button>
    </span>
  );
}
