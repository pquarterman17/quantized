// Wording for `.opj` graph curves whose column the file records on another
// sheet than the one their binding names (`OriginFigure.curve_sheet_notes`,
// from `io/origin_project/opj_curve_sheets.py`). The reader only knows the
// sheets; whether the bound book reached THIS import is known here, so the
// sentence is built here, against the import's own books, and one window
// never says both "plotted from sheet 1" and "that sheet is not imported".

import type { OriginCurveSheetNote, OriginFigure } from "./types";

/** One graph layer's curves of one book recorded on one other sheet. */
export interface CurveSheetGroup {
  graph: string;
  book: string;
  recorded: string;
  columns: string[];
  /** Is the book the binding names among this import's books? */
  bookImported: boolean;
}

function graphName(figure: OriginFigure): string {
  const name = figure.name || "Graph";
  return (figure.layer ?? 1) >= 2 ? `${name} layer ${figure.layer}` : name;
}

/** The notes of `figures`, grouped per graph layer + book + recorded sheet,
 *  in first-seen order, each column listed once. */
export function curveSheetGroups(
  figures: readonly OriginFigure[],
  importedBooks: ReadonlySet<string>,
): CurveSheetGroup[] {
  const groups = new Map<string, CurveSheetGroup>();
  for (const figure of figures) {
    for (const note of (figure.curve_sheet_notes ?? []) as OriginCurveSheetNote[]) {
      const graph = graphName(figure);
      const key = JSON.stringify([graph, note.book, note.recorded]);
      let group = groups.get(key);
      if (!group) {
        group = { graph, book: note.book, recorded: note.recorded, columns: [], bookImported: importedBooks.has(note.book) };
        groups.set(key, group);
      }
      if (!group.columns.includes(note.y)) group.columns.push(note.y);
    }
  }
  return [...groups.values()];
}

/** One sentence for a group, e.g. "6 curves of Graph1 (Book1 columns B, D,
 *  F, C, E, G) are recorded on Book1@6; the sheet the graph would otherwise
 *  use (Book1) is not in this import; use Recover to choose the sheet". */
export function curveSheetLine(group: CurveSheetGroup): string {
  const n = group.columns.length;
  const one = n === 1;
  const which = `${one ? "1 curve" : `${n} curves`} of ${group.graph} (${group.book} column${one ? "" : "s"} ${group.columns.join(", ")})`;
  const head = `${which} ${one ? "is" : "are"} recorded on ${group.recorded}`;
  return group.bookImported
    ? `${head} but plotted from ${group.book}; check ${one ? "it" : "them"}, or use Recover to choose the sheet`
    : `${head}; the sheet the graph would otherwise use (${group.book}) is not in this import; use Recover to choose the sheet`;
}

/** Is `curve` (by book + column) one the file records on another sheet?
 *  Returns that sheet's book key, or undefined. */
export function recordedSheetOf(figure: OriginFigure, book: string, column: string): string | undefined {
  return (figure.curve_sheet_notes ?? []).find((note) => note.book === book && note.y === column)?.recorded;
}
