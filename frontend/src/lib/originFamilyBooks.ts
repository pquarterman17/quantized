// The worksheet book switcher's helpers (WORKSHEET_PLAN item 9), moved
// verbatim out of lib/grouping.ts (bundle diet slice 22,
// plans/BUNDLE_HEADROOM.md). Only the lazy worksheet's `SheetTabs` calls
// them, so they load with it. Import them by path; lib/grouping.ts does not
// re-export this module.

import { originSheetNumber } from "./grouping";
import type { Dataset } from "./types";

/** A book family's `"<stem>:<label>"` name with the stem prefix stripped, for
 *  display once the family context is already established (WORKSHEET_PLAN
 *  item 9's book switcher). Falls back to the whole name when there's no
 *  colon (shouldn't happen for a family member, but defensive). */
export function bookLabel(d: Dataset): string {
  const i = d.name.indexOf(":");
  return i < 0 ? d.name : d.name.slice(i + 1);
}

/** One DISTINCT book within an Origin project family (WORKSHEET_PLAN item 9's
 *  book switcher): collapses a multi-sheet book's several pseudo-book
 *  datasets (`Book4`, `Book4@2`, `Book4@3`, …) down to ONE representative
 *  (its earliest sheet) — `originBookFamilies` buckets by import stem alone,
 *  so a family of sheet-siblings from ONE book (already handled by
 *  `originSheetGroups`/`SheetTabs`) must not ALSO look like multiple distinct
 *  books here. Order = first appearance of each base `origin_book`. */
export interface FamilyBookEntry {
  /** The base `origin_book` value (no `"@N"` suffix) identifying this book. */
  book: string;
  /** The earliest-sheet (or first-seen) dataset representing this book. */
  representative: Dataset;
}

export function familyBooks(members: Dataset[]): FamilyBookEntry[] {
  const order: string[] = [];
  const bestForBook = new Map<string, Dataset>();
  for (const d of members) {
    const raw = (d.data.metadata as Record<string, unknown> | undefined)?.origin_book;
    if (typeof raw !== "string" || !raw) continue;
    const base = raw.split("@")[0] || raw;
    const best = bestForBook.get(base);
    if (!best) {
      order.push(base);
      bestForBook.set(base, d);
    } else if (originSheetNumber(d) < originSheetNumber(best)) {
      bestForBook.set(base, d); // an earlier sheet is the better representative
    }
  }
  return order.map((book) => ({ book, representative: bestForBook.get(book)! }));
}
