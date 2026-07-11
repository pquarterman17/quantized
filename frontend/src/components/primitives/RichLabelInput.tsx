// Label editor input with rich-text support (GOTO #5): a plain text field
// plus an Ω symbol-palette button, a live preview line (rendered through the
// same RichText renderer the legend uses), and validate() feedback while the
// draft contains `$...$` markup. Commit-on-blur/Enter by default (the
// TitlesCard convention: typing isn't reformatted mid-edit); `live` commits
// every keystroke (the FigureBuilder convention). Escape reverts the draft.

import { useEffect, useRef, useState } from "react";

import { hasMarkup, validateRichText } from "../../lib/richtext";
import RichText from "./RichText";
import SymbolPalette, { insertLabelToken, type PaletteEntry } from "./SymbolPalette";

interface RichLabelInputProps {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  /** Commit on every keystroke (FigureBuilder) instead of blur/Enter. */
  live?: boolean;
}

export default function RichLabelInput({ value, onCommit, placeholder, live = false }: RichLabelInputProps) {
  const [draft, setDraft] = useState(value);
  const [palette, setPalette] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mirror store -> field when it changes elsewhere (dataset switch / reset).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (v: string): void => {
    if (v !== value) onCommit(v);
  };

  const update = (v: string): void => {
    setDraft(v);
    if (live) commit(v);
  };

  const insert = (entry: PaletteEntry): void => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const { value: next, cursor } = insertLabelToken(draft, start, end, entry);
    setDraft(next);
    // A palette insert is a deliberate edit — commit it (keeps the store in
    // sync even in blur-commit mode, where the button press blurred nothing
    // thanks to the palette's mousedown preventDefault).
    commit(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  };

  const check: { ok: boolean; error?: string } = hasMarkup(draft)
    ? validateRichText(draft)
    : { ok: true };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          ref={inputRef}
          className="qz-input"
          style={{ flex: 1, minWidth: 0 }}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onBlur={() => {
            if (!live) commit(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
            if (e.key === "Escape") setDraft(value);
          }}
        />
        <button
          className="qz-icon-btn"
          title={'Insert symbol — Greek, sub/superscript, Å, ° ("$...$" math labels)'}
          aria-label="Insert symbol"
          onClick={(e) => {
            if (palette) {
              setPalette(null);
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            setPalette({ x: r.left, y: r.bottom + 4 });
          }}
        >
          Ω
        </button>
      </div>
      {hasMarkup(draft) && (
        <div
          style={{
            marginTop: 2,
            fontSize: "var(--font-size-sm)",
            color: check.ok ? "var(--text-dim)" : "var(--danger)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {check.ok ? <RichText text={draft} /> : `Invalid markup: ${check.error}`}
        </div>
      )}
      {palette && (
        <SymbolPalette
          x={palette.x}
          y={palette.y}
          onInsert={insert}
          onClose={() => setPalette(null)}
        />
      )}
    </div>
  );
}
