// Worksheet navigation strip (WORKSHEET_PLAN items 5 + 9): a bottom strip
// composing TWO independent affordances over the same row — a compact
// book-switcher dropdown at the left end (item 9, when the viewed dataset
// belongs to a multi-book Origin project family with more than one DISTINCT
// book — `lib/grouping.familyBooks`) and the sheet-tab buttons (item 5, when
// the viewed dataset's book has more than one sheet — `originSheetGroups`).
// Either, both, or neither can apply; the strip renders null only when
// NEITHER does, so a non-Origin / single-book / single-sheet dataset costs
// nothing. Composes ONLY over `lib/grouping` + the store's
// `activateFromLibrary` — no new store slice.
//
// Clicking a tab or choosing a book calls `activateFromLibrary` — "identical
// to a Library click," which since item 15 means it routes through the
// `originBookClickOpens` pref like any other row: every member here IS an
// Origin book/sheet (that's what makes a sheet/book group exist at all), so
// under the default "worksheet" pref this only moves `worksheetId` + the
// worksheet's own `datasetId` prop — the focused plot window and its view
// are left exactly as they were, never yanked or reset, switching sheets is
// pure browsing. (`nextStageTab`'s "stay on worksheet" guard, from before
// item 15, is now moot for this call site specifically — worksheet-intent
// never touches `stageTab` away from "worksheet" in the first place — but
// still applies if the pref is "plot".)

import { originBookFamilies, originSheetGroups, originSheetNumber } from "../../../lib/grouping";
import { bookLabel, familyBooks } from "../../../lib/originFamilyBooks";
import { onTabListKeyDown } from "../../../lib/tabListKeys";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export interface SheetTabsProps {
  /** The dataset currently shown in the worksheet (WorksheetPane's own
   *  `datasetId` prop) — used to find its family/sheet-group siblings and
   *  highlight the active tab/book. Reading the full `datasets` list (below)
   *  to compute the group is NOT a singleton-view read; it's the same
   *  "all datasets" read the Library's BookFamiliesSection already does. */
  datasetId: string;
}

/** The base `origin_book` (no `@N` sheet suffix) of `datasetId` within
 *  `members`, or undefined if it isn't a member (defensive). */
function currentBaseBook(members: Dataset[], datasetId: string): string | undefined {
  const d = members.find((m) => m.id === datasetId);
  const raw = (d?.data.metadata as Record<string, unknown> | undefined)?.["origin_book"];
  if (typeof raw !== "string" || !raw) return undefined;
  return raw.split("@")[0] || raw;
}

export default function SheetTabs({ datasetId }: SheetTabsProps) {
  const datasets = useApp((s) => s.datasets);
  const activateFromLibrary = useApp((s) => s.activateFromLibrary);

  const family = originBookFamilies(datasets).find((f) => f.members.some((m) => m.id === datasetId));
  const books = family ? familyBooks(family.members) : [];
  const currentBook = family ? currentBaseBook(family.members, datasetId) : undefined;

  const group = originSheetGroups(datasets).find((g) => g.members.some((m) => m.id === datasetId));
  // Any other workbook with several worksheets -- a multi-sheet .xlsx, or
  // files imported "as sheets of one workbook" -- gets tabs too (worksheet
  // audit #20; they were Origin-only).
  const book = group ? [] : workbookSheets(datasets, datasetId);

  if (books.length <= 1 && !group && book.length < 2) return null; // nothing to switch between

  return (
    <div className="qzk-sheet-tabs">
      {books.length > 1 && (
        <select
          className="qz-select qzk-book-switcher"
          aria-label="switch book"
          value={currentBook ?? ""}
          onChange={(e) => {
            const entry = books.find((b) => b.book === e.target.value);
            if (entry) activateFromLibrary(entry.representative.id);
          }}
          title="Jump to another book in this Origin project"
        >
          {books.map((b) => (
            <option key={b.book} value={b.book}>
              {bookLabel(b.representative)}
            </option>
          ))}
        </select>
      )}
      {/* Roving tablist, MANUAL activation (lib/tabListKeys): a switch re-renders
          the whole grid (or rebinds the plot under the "plot" pref), so arrows
          move focus only and Enter/Space selects. Holds ONLY the tabs. */}
      {group && (
        <div className="qzk-sheet-tablist" role="tablist" aria-label="Origin worksheet sheets" onKeyDown={(e) => onTabListKeyDown(e, false)}>
          {group.members.map((m) => {
            const n = originSheetNumber(m);
            const meta = m.data.metadata as Record<string, unknown> | undefined;
            const long = String(meta?.["origin_book_long"] ?? "");
            const active = m.id === datasetId;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={`qzk-sheet-tab${active ? " active" : ""}`}
                title={long || m.name}
                onClick={() => activateFromLibrary(m.id)}
              >
                <span className="qzk-sheet-tab-num">{n}</span>
                <span className="qzk-sheet-tab-name">{long || `sheet ${n}`}</span>
              </button>
            );
          })}
        </div>
      )}
      {book.length > 1 && (
        <div className="qzk-sheet-tablist" role="tablist" aria-label="Workbook sheets" onKeyDown={(e) => onTabListKeyDown(e, false)}>
          {book.map((m, i) => {
            const active = m.id === datasetId;
            const name = sheetName(m);
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={`qzk-sheet-tab${active ? " active" : ""}`}
                title={m.name}
                // Pure browsing, as an Origin sheet tab: the worksheet moves,
                // the plot window and the Stage tab stay where they are.
                onClick={() => useApp.setState({ worksheetId: m.id, selectedIds: [m.id], librarySelection: null })}
              >
                <span className="qzk-sheet-tab-num">{i + 1}</span>
                <span className="qzk-sheet-tab-name">{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The worksheets of `datasetId`'s workbook, in Library order (empty when it
 *  has no workbook). */
function workbookSheets(datasets: Dataset[], datasetId: string): Dataset[] {
  const wb = datasets.find((d) => d.id === datasetId)?.workbookId;
  return wb ? datasets.filter((d) => d.workbookId === wb) : [];
}

/** A tab's label: the spreadsheet's own sheet name, else the worksheet's. */
function sheetName(d: Dataset): string {
  const raw = (d.data.metadata as Record<string, unknown> | undefined)?.["sheet_name"];
  return typeof raw === "string" && raw ? raw : d.name.replace(/\.[^.]+$/, "");
}
