import { useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

/** Commit-on-Enter/blur text buffer shared by the numeric fields.
 *
 *  `committed` is the exact text of the store value. While the input is
 *  neither focused nor edited it shows `committed` (so an external change,
 *  e.g. undo, shows through); on focus or first keystroke a local `draft`
 *  takes over, so an in-progress "-", "1." or "" is never snapped back.
 *
 *  - Enter: commit the draft once if it was edited (focus stays).
 *  - blur: commit once if edited; a blur of unedited text writes nothing.
 *  - Esc: revert, leave the field and stop propagation (so an enclosing
 *    window's Escape does not also act). Unedited text lets Esc bubble.
 *  - `commit(draft)` returns the normalized text that was accepted, or null
 *    when the draft is invalid (it then reverts to `committed`).
 *  - `live` also commits on every keystroke (a live-preview field); an
 *    invalid keystroke simply writes nothing and stays in the buffer.
 *  - A `committed` change this hook did not write (undo, Reset, a replaced
 *    draft) drops the buffer, so the field follows the store. */
export function useCommitDraft(committed: string, commit: (draft: string) => string | null, live = false) {
  const [draft, setDraft] = useState<string | null>(null);
  const skipBlur = useRef(false);
  const own = useRef<string | null>(null); // last text this hook wrote
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    setSeen(committed);
    if (committed !== own.current) setDraft(null);
  }
  const write = (text: string) => {
    const accepted = commit(text);
    if (accepted !== null) own.current = accepted;
    return accepted;
  };
  const edited = draft !== null && draft !== committed;

  const finish = (keepFocus: boolean) => {
    if (edited) {
      const accepted = write(draft);
      setDraft(keepFocus ? (accepted ?? committed) : null);
    } else if (!keepFocus) setDraft(null);
  };

  return {
    text: draft ?? committed,
    inputProps: {
      onFocus: () => setDraft((d) => d ?? committed),
      onBlur: (_e: FocusEvent<HTMLInputElement>) => {
        if (skipBlur.current) skipBlur.current = false;
        else finish(false);
        setDraft(null);
      },
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape" && edited) {
          e.stopPropagation();
          skipBlur.current = true;
          setDraft(null);
          e.currentTarget.blur();
        }
      },
      onChange: (next: string) => {
        setDraft(next);
        if (live) write(next);
      },
    },
  };
}
