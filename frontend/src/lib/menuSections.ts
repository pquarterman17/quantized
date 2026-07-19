// Menu sectioning (GUI_INTERACTION #17) — turn a flat list of Actions into a
// render list with sub-headers.
//
// The Analyze menu had grown to 17 flat items in registry-declaration order,
// with no way to find "the peak tools" or "the reflectivity tools" other than
// reading all 17. The plan's fix is sub-topic grouping, so `Action.section`
// is an OPTIONAL label and this module turns it into headers.
//
// Grouping is STABLE, not contiguous: sections appear in the order they are
// first seen, and every item of a section is gathered under its one header
// regardless of where it sits in the declaration list. A contiguous-run
// implementation would be simpler, but it silently emits a DUPLICATE header
// the first time someone adds a command in the "wrong" place — the exact
// maintenance trap this item is trying to remove.
//
// Unsectioned actions keep their relative order and render FIRST, with no
// header, so a menu that never sets `section` renders byte-identically to
// before (every menu except Analyze today).
//
// Pure: no store import, no React.

import type { Action } from "../store/commands";

export type MenuRow = { kind: "header"; label: string } | { kind: "item"; action: Action };

/** Flatten actions into rows, inserting one header per distinct `section`. */
export function withSectionHeaders(actions: readonly Action[]): MenuRow[] {
  const unsectioned: Action[] = [];
  const bySection = new Map<string, Action[]>();
  for (const a of actions) {
    if (!a.section) {
      unsectioned.push(a);
      continue;
    }
    const bucket = bySection.get(a.section);
    if (bucket) bucket.push(a);
    else bySection.set(a.section, [a]); // Map preserves first-insertion order
  }
  const rows: MenuRow[] = unsectioned.map((action) => ({ kind: "item", action }));
  for (const [label, items] of bySection) {
    rows.push({ kind: "header", label });
    for (const action of items) rows.push({ kind: "item", action });
  }
  return rows;
}

/** Does this action list use sections at all? Lets a caller keep the old
 *  flat rendering path untouched for menus that don't. */
export function hasSections(actions: readonly Action[]): boolean {
  return actions.some((a) => !!a.section);
}
