// The worksheet's CELL right-click menu (UX audit 10, P1-5): Cut / Copy / Paste
// / Clear contents / Fill down over the cell range, which a right-click on a
// data cell used to omit (it opened the row-number menu). Pure: the block
// operations are supplied by ./useWorksheetBlockOps.ts, so it is testable
// without rendering. The rest of the cell menu is the row menu's items.

import type { DateUnit } from "../../../lib/gridSeries";
import { formatShortcut, isMacPlatform } from "../../../lib/shortcutFormat";
import type { ContextMenuItem } from "../../overlays/ContextMenu";
import type { BlockOpsApi } from "./useWorksheetBlockOps";

export interface CellMenuControls {
  ops: BlockOpsApi;
  /** A re-derived sheet refuses edits: the editing entries disable with this reason. */
  readOnlyReason?: string | null;
}

const NO_SELECTION = "select cells first";

/** Cut / Copy / Paste, then Clear contents / Fill down. */
export function cellBlockItems({ ops, readOnlyReason }: CellMenuControls, isMac = isMacPlatform()): ContextMenuItem[] {
  const key = (k: string) => formatShortcut(`⌘${k}`, isMac);
  const why = (needsBlock: boolean, edits: boolean): string | undefined =>
    edits && readOnlyReason ? readOnlyReason : needsBlock && !ops.hasBlock ? NO_SELECTION : undefined;
  const item = (label: string, run: () => void, needsBlock: boolean, edits: boolean, shortcut?: string): ContextMenuItem => {
    const reason = why(needsBlock, edits);
    return { label, run, disabled: reason !== undefined, title: reason, shortcutLabel: shortcut };
  };
  // Options beside the defaults (the plain Copy / Paste above are unchanged).
  const copyAs: ContextMenuItem[] = [];
  const { copyDisplayed, copyTable, pasteTrimmed } = ops;
  if (copyDisplayed || copyTable) {
    copyAs.push({
      label: "Copy as",
      disabled: !ops.hasBlock,
      title: ops.hasBlock ? undefined : NO_SELECTION,
      submenu: [
        ...(copyDisplayed ? [item("Displayed (rounded, as shown)", copyDisplayed, true, false)] : []),
        ...(copyTable ? [item("Table (for Word / PowerPoint)", copyTable, true, false)] : []),
      ],
    });
  }
  const pasteSpecial: ContextMenuItem[] = pasteTrimmed
    ? [{ label: "Paste special", disabled: why(false, true) !== undefined, title: why(false, true), submenu: [item("Paste with trimmed spaces", pasteTrimmed, false, true)] }]
    : [];
  return [
    item("Cut", ops.cutBlock, true, true, key("X")),
    item("Copy", ops.copyBlock, true, false, key("C")),
    ...copyAs,
    item("Paste", ops.pasteBlock, false, true, key("V")),
    ...pasteSpecial,
    item("Clear contents", ops.clearBlock, true, true, "Delete"),
    { separator: true },
    item("Fill down", ops.fillDown, true, true, key("D")),
    ...fillSeriesItems(ops, why),
  ];
}

const UNITS: [DateUnit, string][] = [["day", "days"], ["week", "weeks"], ["month", "months"], ["year", "years"]];

/** Fill series: numbers down / across (step from the first two cells), and date series when the X column holds dates. */
function fillSeriesItems(ops: BlockOpsApi, why: (needsBlock: boolean, edits: boolean) => string | undefined): ContextMenuItem[] {
  const fill = ops.fillSeries;
  if (!fill) return [];
  const reason = why(true, true);
  const entry = (label: string, run: () => void, title?: string): ContextMenuItem => ({ label, run, disabled: reason !== undefined, title: reason ?? title });
  return [
    {
      label: "Fill series",
      disabled: reason !== undefined,
      title: reason,
      submenu: [
        entry("Numbers down", () => fill("down"), "Start from the top cell, or the top two cells for the step"),
        entry("Numbers across", () => fill("across"), "Start from the left cell, or the left two cells for the step"),
        ...(ops.hasDates
          ? [
              ...UNITS.map(([u, plural]) => entry(`Dates down by ${plural}`, () => fill("down", u), "Month ends clamp: Jan 31 + 1 month is Feb 28")),
              ...(["down", "across"] as const).map((d) => entry(`Dates ${d}, step from two cells`, () => fill(d, "auto"), "Day, week, month or year, read from the first two dates")),
            ]
          : []),
      ],
    },
  ];
}
