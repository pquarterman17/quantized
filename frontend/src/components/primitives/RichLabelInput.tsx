// Label editor input with rich-text support (GOTO #5): a plain text field
// plus an Ω symbol-palette button, a live preview line (rendered through the
// same RichText renderer the legend uses), and validate() feedback while the
// draft contains `$...$` markup. Commit-on-blur/Enter by default (the
// TitlesCard convention: typing isn't reformatted mid-edit); `live` commits
// every keystroke (the FigureBuilder convention). Escape reverts the draft.
//
// MAIN #17 — wrap-selection keyboard shortcuts (same insertion mechanics +
// caret-restore idiom as a palette click, so they commit the same way in
// both `live` and blur-commit mode): Ctrl/Cmd+I wraps the selection in
// italic, Ctrl+= / Ctrl+Shift+= wrap it in sub/superscript, Ctrl/Cmd+.
// opens the symbol palette from the keyboard. An empty selection inserts
// the empty token with the cursor placed inside the braces (unchanged
// palette-click behaviour, reused as-is).

import { useEffect, useRef, useState } from "react";

import { hasMarkup, validateRichText } from "../../lib/richtext";
import RichText from "./RichText";
import SymbolPalette, {
  insertLabelToken,
  ITALIC_ENTRY,
  SUBSCRIPT_ENTRY,
  SUPERSCRIPT_ENTRY,
  wrapLabelSelection,
  type PaletteEntry,
} from "./SymbolPalette";

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
  const omegaRef = useRef<HTMLButtonElement>(null);

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

  /** Shared apply + caret-restore idiom for both the palette (point-insert)
   *  and the keyboard shortcuts (wrap-or-insert): compute the new draft
   *  from the current selection, commit it (a deliberate edit, same as any
   *  palette insert — keeps the store in sync in blur-commit mode too),
   *  then restore focus + caret next frame. */
  const apply = (
    entry: PaletteEntry,
    build: (v: string, s: number, e: number, en: PaletteEntry) => { value: string; cursor: number },
  ): void => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const { value: next, cursor } = build(draft, start, end, entry);
    setDraft(next);
    commit(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  };

  const insert = (entry: PaletteEntry): void => apply(entry, insertLabelToken);

  const togglePalette = (): void => {
    if (palette) {
      setPalette(null);
      return;
    }
    const r = (omegaRef.current ?? inputRef.current)?.getBoundingClientRect();
    if (!r) return;
    setPalette({ x: r.left, y: r.bottom + 4 });
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
            if (e.key === "Enter") {
              commit(draft);
              return;
            }
            if (e.key === "Escape") {
              setDraft(value);
              return;
            }
            if (e.altKey) return;
            // Ctrl/Cmd+I — italic wrap.
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "i") {
              e.preventDefault();
              apply(ITALIC_ENTRY, wrapLabelSelection);
              return;
            }
            // Ctrl+. / Cmd+. — open the symbol palette from the keyboard.
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === "Period" || e.key === ".")) {
              e.preventDefault();
              togglePalette();
              return;
            }
            // Ctrl+= subscript, Ctrl+Shift+= superscript — Ctrl ONLY (never
            // Cmd): Cmd+=/Cmd+Shift+= is the macOS/Safari browser zoom
            // accelerator, which JS preventDefault can't reliably suppress
            // there. `code` (the physical "=/+" key) is used rather than
            // `key` so Shift's US-layout remap of "=" to "+" doesn't affect
            // detection.
            if (e.ctrlKey && !e.metaKey && e.code === "Equal") {
              e.preventDefault();
              apply(e.shiftKey ? SUPERSCRIPT_ENTRY : SUBSCRIPT_ENTRY, wrapLabelSelection);
            }
          }}
        />
        <button
          ref={omegaRef}
          className="qz-icon-btn"
          title={
            'Insert symbol — Greek, sub/superscript, Å, ° ("$...$" math labels). ' +
            "Ctrl/Cmd+I italic · Ctrl+= subscript · Ctrl+Shift+= superscript · Ctrl+. this palette"
          }
          aria-label="Insert symbol"
          onClick={togglePalette}
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
