// What the last in-app block copy was, for the notes half of a paste (ROW_RANGE_CONTRACT 7.2, D16).
// Session only, never persisted. Kept out of lib/clipboard.ts so the eager bundle does not carry it: only the
// worksheet's block operations import this module.

/** The clipboard text the copy wrote, the source dataset's metadata AT COPY TIME (immutable, so it holds the
 *  notes as copied), and the source rows and columns in the copied block's order. */
export interface NoteClip {
  text: string;
  metadata: Record<string, unknown> | undefined;
  rows: readonly number[];
  cols: readonly number[];
}

let noteClip: NoteClip | null = null;

export function setNoteClip(text: string, metadata: NoteClip["metadata"], rows: readonly number[], cols: readonly number[]): void {
  noteClip = { text, metadata, rows, cols };
}

/** The record, only while the clipboard still holds the very text it wrote. A record that went stale (another
 *  app copied other text since) is null: it attaches no notes to unrelated text. */
export function noteClipFor(text: string): NoteClip | null {
  return noteClip?.text === text ? noteClip : null;
}
