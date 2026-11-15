// A numeric view-angle input that commits on blur / Enter (one gesture, one
// state change -- and one 3-D render, not one per keystroke). A blank or
// out-of-range entry is INVALID, never 0: it is flagged and not committed, and
// leaving it blank restores the stored value. Escape abandons the edit.

import { useState } from "react";

const ROW = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11 } as const;

export default function AngleField({ label, value, lim, onCommit }: { label: string; value: number; lim: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const n = Number(draft);
  const bad = draft !== null && (draft.trim() === "" || !Number.isFinite(n) || Math.abs(n) > lim);
  const commit = () => {
    if (draft === null) return;
    if (!bad) onCommit(n);
    if (!bad || draft.trim() === "") setDraft(null);
  };
  return (
    <label style={ROW}>
      {label}
      <input
        type="number"
        step="any"
        min={-lim}
        max={lim}
        aria-label={label}
        aria-invalid={bad}
        title={bad ? `${label} must be a number from -${lim} to ${lim}` : `-${lim} to ${lim} degrees`}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        style={{ width: 70, ...(bad ? { borderColor: "var(--danger)" } : {}) }}
      />
    </label>
  );
}
