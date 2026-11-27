// Cell notes across a re-import (ROW_RANGE_CONTRACT 7.1): positions, so they are kept only when the shape is
// unchanged (rows added after untouched ones count as unchanged: `shapeChanged` in store/reimport.ts) and
// otherwise dropped and COUNTED, never silently. Kept out of store/reimport.ts, which sits at its size ceiling.

import { noteCount } from "./cellNotes";
import { CELL_NOTES_KEY } from "./rowSidecars";
import type { DataStruct } from "./types";

/** `fresh` (the re-read data) carrying the notes of `prev` when the shape is unchanged, and how many notes were
 *  dropped when it was not. Whatever notes the fresh data itself held are stale and never replace the user's. */
export function carryReimportNotes(prev: DataStruct, fresh: DataStruct, shapeChanged: boolean): { data: DataStruct; dropped: number } {
  const notes = prev.metadata[CELL_NOTES_KEY];
  if (!notes) return { data: fresh, dropped: 0 };
  const { [CELL_NOTES_KEY]: _stale, ...rest } = fresh.metadata;
  return {
    data: { ...fresh, metadata: shapeChanged ? rest : { ...rest, [CELL_NOTES_KEY]: notes } },
    dropped: shapeChanged ? noteCount(prev.metadata) : 0,
  };
}

/** The sentence for a re-import that dropped `n` notes (a toast, and the end of the status line). */
export function droppedNotesText(n: number): string {
  return `${n} cell note${n === 1 ? " was" : "s were"} dropped because the shape changed (Undo restores ${n === 1 ? "it" : "them"})`;
}
