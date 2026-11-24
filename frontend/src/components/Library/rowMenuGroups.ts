// Grouping helpers for the Library row menus (UX audit 10, P1-7): the dataset
// and workbook rows offered 24-30 flat entries and 9 separators. The rarely
// used families (source / re-import, move, derive, multi-selection) now sit in
// one submenu each, so a row menu stays at 16 top-level entries or fewer.
// Pure, so the item-count ceiling is unit-testable without rendering.

import type { ContextMenuItem } from "../overlays/ContextMenu";

/** Largest number of top-level entries (separators and the Help footer not
 *  counted) a Library row menu may have. Pinned by rowMenuGroups.test.ts. */
export const ROW_MENU_MAX_ITEMS = 16;

const isSeparator = (i: ContextMenuItem): boolean => "separator" in i;

/** Drop leading, trailing and doubled separators (a group that is empty
 *  leaves its neighbours' separators behind otherwise). */
export function tidySeparators(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const it of items) {
    if (isSeparator(it) && (out.length === 0 || isSeparator(out[out.length - 1]))) continue;
    out.push(it);
  }
  while (out.length && isSeparator(out[out.length - 1])) out.pop();
  return out;
}

/** One submenu entry, or nothing when it would be empty. */
export function submenuItem(label: string, items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const inner = tidySeparators(items);
  return inner.some((i) => !isSeparator(i)) ? [{ label, submenu: inner }] : [];
}

/** Join groups with a single separator between the non-empty ones. */
export function joinGroups(...groups: readonly (readonly ContextMenuItem[])[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    if (out.length) out.push({ separator: true });
    out.push(...g);
  }
  return tidySeparators(out);
}

/** How many entries a menu shows at its top level. */
export const topLevelCount = (items: readonly ContextMenuItem[]): number => items.filter((i) => !isSeparator(i)).length;
