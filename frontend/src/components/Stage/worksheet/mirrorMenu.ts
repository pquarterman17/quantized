// The mirror column's menu entries (plans/ROW_RANGE_CONTRACT.md 6.4) and its
// create dialog. Pure builders plus one dialog; the actions live in
// store/mirrorColumn.ts, loaded on first use so none of it is startup code.

import * as glyphs from "../../../lib/glyphs";
import { mirrorIndexAt, mirrorLink, mirrorSourceText } from "../../../lib/mirrorColumn";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import type { Dataset } from "../../../lib/types";
import type { ContextMenuItem } from "../../overlays/ContextMenu";
import { mirrorColumnDialog } from "../../../store/mirrorColumnDialog";

export { mirrorColumnDialog };
const lazyStore = () => runLazy("Loading mirror columns…", () => import("../../../store/mirrorColumn"));

/** The entries for a header right-click on column `col`: Mirror column… on any
 *  sheet, and Go to Source / Detach on a mirror. */
export function mirrorHeaderItems(ds: Dataset, col: number): ContextMenuItem[] {
  const index = mirrorIndexAt(ds, col);
  const link = index >= 0 ? mirrorLink(ds.formulas![index]) : null;
  const create: ContextMenuItem = {
    label: "Mirror column…",
    title: "Add a column that follows a column of another worksheet, row for row",
    run: () => void mirrorColumnDialog(ds.id),
  };
  if (!link) return [{ separator: true }, create];
  return [
    { separator: true },
    {
      label: `${glyphs.columnMirror} Go to Source (${mirrorSourceText(link)})`,
      disabled: link.sourceId === null,
      title: link.sourceId === null ? "the source worksheet was deleted" : "Open the source worksheet and select its column",
      run: () => void lazyStore().then((m) => m.goToMirrorSource(ds.id, index), onLoadFailure),
    },
    {
      label: "Detach (make ordinary values)",
      title: "Turn this mirror into plain values; it stops following the source",
      run: () => void lazyStore().then((m) => m.detachMirror(ds.id, index), onLoadFailure),
    },
    create,
  ];
}

/** Go to Source for the cell menu on column `col`, row `row`: also reveals the same row. */
export function mirrorCellItems(ds: Dataset, col: number | undefined, row: number): ContextMenuItem[] {
  const index = col === undefined ? -1 : mirrorIndexAt(ds, col);
  const link = index >= 0 ? mirrorLink(ds.formulas![index]) : null;
  if (!link) return [];
  return [
    {
      label: `${glyphs.columnMirror} Go to Source row ${row + 1} (${mirrorSourceText(link)})`,
      disabled: link.sourceId === null,
      title: link.sourceId === null ? "the source worksheet was deleted" : undefined,
      run: () => void lazyStore().then((m) => m.goToMirrorSource(ds.id, index, row), onLoadFailure),
    },
    { separator: true },
  ];
}
