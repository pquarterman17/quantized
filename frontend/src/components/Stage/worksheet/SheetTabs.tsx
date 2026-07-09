// Worksheet navigation strip (WORKSHEET_PLAN items 5 + 9): a bottom strip
// composing TWO independent affordances over the same row — a compact
// book-switcher dropdown at the left end (item 9, when the viewed dataset
// belongs to a multi-book Origin project family with more than one DISTINCT
// book — `lib/grouping.familyBooks`) and the sheet-tab buttons (item 5, when
// the viewed dataset's book has more than one sheet — `originSheetGroups`).
// Either, both, or neither can apply; the strip renders null only when
// NEITHER does, so a non-Origin / single-book / single-sheet dataset costs
// nothing. Composes ONLY over `lib/grouping` + the store's `setActive` — no
// new store slice, no persistence (the active sheet/book IS `activeId`,
// already round-tripped via `.dwk`).
//
// Clicking a tab or choosing a book calls `setActive`, verified safe here:
// `nextStageTab` returns `current` when the stage tab is already "worksheet",
// so switching sheets/books can never yank the user to the Plot/Map tab (it
// DOES reset the singleton plot view block, identical to a Library click
// today — acceptable and consistent).

import { bookLabel, familyBooks, originBookFamilies, originSheetGroups, originSheetNumber } from "../../../lib/grouping";
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
  const setActive = useApp((s) => s.setActive);

  const family = originBookFamilies(datasets).find((f) => f.members.some((m) => m.id === datasetId));
  const books = family ? familyBooks(family.members) : [];
  const currentBook = family ? currentBaseBook(family.members, datasetId) : undefined;

  const group = originSheetGroups(datasets).find((g) => g.members.some((m) => m.id === datasetId));

  if (books.length <= 1 && !group) return null; // nothing to switch between

  return (
    <div className="qzk-sheet-tabs" role="tablist" aria-label="Origin worksheet sheets">
      {books.length > 1 && (
        <select
          className="qz-select qzk-book-switcher"
          aria-label="switch book"
          value={currentBook ?? ""}
          onChange={(e) => {
            const entry = books.find((b) => b.book === e.target.value);
            if (entry) setActive(entry.representative.id);
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
      {group?.members.map((m) => {
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
            className={`qzk-sheet-tab${active ? " active" : ""}`}
            title={long || m.name}
            onClick={() => setActive(m.id)}
          >
            <span className="qzk-sheet-tab-num">{n}</span>
            <span className="qzk-sheet-tab-name">{long || `sheet ${n}`}</span>
          </button>
        );
      })}
    </div>
  );
}
