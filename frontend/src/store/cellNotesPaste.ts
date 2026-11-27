// The one notes step every worksheet clipboard path goes through (ROW_RANGE_CONTRACT 7.2, D16).
//
// Cursor paste (`pasteGrowing`), block paste (`useWorksheetBlockOps`) and the cell menu's Paste (which
// calls one of those two) all hand their cell edit's result here; cut hands over its clearing edit. The
// notes module itself loads lazily, on the first copy-with-notes paste or cut.

import type { NoteChange } from "../lib/cellNotes";
import { noteClipFor } from "../lib/cellNotesClip";
import { onLoadFailure, runLazy } from "../lib/runLazy";

type NotesModule = typeof import("./cellNotes");

/** Run `run` against the notes module once the cell edit `done` (which owns the undo entry; its action may still be loading) has landed. */
export function notesAfter(done: unknown, run: ((m: NotesModule) => void) | null): void {
  if (run) void Promise.resolve(done).then(() => runLazy("Loading notes…", () => import("./cellNotes"))).then(run, onLoadFailure);
}

/** A paste of clipboard `text`: when it is the text of the last in-app copy, the pasted cells take that copy's notes
 *  (an empty source cell clears the target's); any other text leaves every note alone. */
export function notesAfterPaste(
  done: unknown,
  id: string,
  text: string,
  edits: readonly Pick<NoteChange, "row" | "col">[],
  targets: readonly number[],
  anchorCol: number,
  grid: readonly (readonly string[])[],
): void {
  const clip = noteClipFor(text);
  notesAfter(done, clip && ((m) => m.pasteNotes(id, clip, edits, targets, anchorCol, grid)));
}
