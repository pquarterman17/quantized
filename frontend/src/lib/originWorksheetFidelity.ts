// What an Origin `.opju` import did NOT bring in from its worksheets, in
// words: the project summary (`origin_fidelity.worksheet`, from
// io/origin_project/worksheet_fidelity.py) for the Library's Origin fidelity
// entry, and each book's own losses (`metadata.origin_worksheet_losses`, from
// io/origin_project/opju_worksheet.py) for the Origin provenance card.
// Kept apart from lib/originFidelity.ts so only the surfaces that show the
// detail pay for its wording.

import type { OriginWorksheetFidelity, OriginWorksheetLoss } from "./originWorksheetTypes";

// Project-summary codes — [one, many] phrasing.
const WORKSHEET_LOSSES: Record<string, [string, string]> = {
  checksum_failed: [
    "record failed its checksum (values may be corrupt)",
    "records failed their checksum (values may be corrupt)",
  ],
  columns_not_decoded: ["column could not be read", "columns could not be read"],
  datasets_not_decoded: ["other dataset was not read", "other datasets were not read"],
  matrices_not_imported: ["matrix was not imported (shape unknown)", "matrices were not imported (shape unknown)"],
  over_decode_budget: ["dataset is too large to import", "datasets are too large to import"],
  complex_imaginary_omitted: ["complex column: real part only", "complex columns: real part only"],
  stale_cells_dropped: [
    "column had cells past its last used row (dropped)",
    "columns had cells past their last used row (dropped)",
  ],
  text_unresolved: ["column's text cells could not be read", "columns' text cells could not be read"],
  columns_without_header: ["column was found without its header", "columns were found without their header"],
  records_without_header: ["damaged record could not be read", "damaged records could not be read"],
};

export function worksheetLossText(loss: OriginWorksheetLoss): string {
  const [one, many] = WORKSHEET_LOSSES[loss.code] ?? [loss.code.replaceAll("_", " "), loss.code.replaceAll("_", " ")];
  return `${loss.count} ${loss.count === 1 ? one : many}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line for the Library's Origin fidelity entry. */
export function worksheetSummaryLine(ws: OriginWorksheetFidelity): string {
  const imported = plural(ws.columns_imported, "column");
  if (ws.losses.length > 0) {
    return `Worksheets: ${imported} imported; ${ws.losses.map(worksheetLossText).join("; ")}`;
  }
  if (ws.unverified_columns > 0) {
    return `Worksheets: ${imported} imported (${ws.unverified_columns} from an older Origin format, read without a length check)`;
  }
  return ws.columns_imported === 0 ? "Worksheets: no worksheet columns" : `Worksheets: all ${imported} imported`;
}

/** Per-book loss kinds (`metadata.origin_worksheet_losses`, from
 *  io/origin_project/opju_worksheet.py) → the provenance card's wording. */
const BOOK_LOSSES: Record<string, string> = {
  checksum_failed: "Failed its checksum — values may be corrupt",
  undecoded: "Not read",
  matrix_coordinates: "X/Y coordinates not recovered — the map axes are cell indices",
  unread_dataset: "Attached datasets not read",
  complex_imaginary: "Complex — imaginary part not imported",
  stale_cells: "Cells past the last used row dropped",
  text_unresolved: "Text cells could not be read",
  no_header: "Found without a column header",
  grammar_only: "Read from an older Origin format, without a length check",
};

/** Not a loss: the data was imported, just without the record-length check
 *  that newer files allow. Shown apart from the losses. */
export const UNVERIFIED_KIND = "grammar_only";

export interface BookLoss {
  kind: string;
  label: string;
  count: number;
  columns: string[];
}

/** `metadata.origin_worksheet_losses` → ordered, labelled rows (unknown or
 *  malformed entries are skipped). */
export function bookLosses(raw: unknown): BookLoss[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: BookLoss[] = [];
  for (const [kind, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const { count, columns } = entry as { count?: unknown; columns?: unknown };
    if (typeof count !== "number" || count <= 0) continue;
    out.push({
      kind,
      label: BOOK_LOSSES[kind] ?? kind.replaceAll("_", " "),
      count,
      columns: Array.isArray(columns) ? columns.map(String) : [],
    });
  }
  const order = Object.keys(BOOK_LOSSES);
  return out.sort((a, b) => (order.indexOf(a.kind) + 1 || 99) - (order.indexOf(b.kind) + 1 || 99));
}
