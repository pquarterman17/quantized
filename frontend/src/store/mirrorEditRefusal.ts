// The one place a refused edit of a mirror column is worded to the user: the
// status line AND a toast (a status line alone reads as "nothing happened",
// the lesson of store/sortRows.ts's refuseRowOrder). Tiny and separate so the
// cell cursor and the cell-edit store body share it without either importing
// the other.

import { mirrorBlockReason, mirrorEditReason, mirrorSourceText, type MirrorLink } from "../lib/mirrorColumn";
import type { Dataset } from "../lib/types";
import { toast } from "./toasts";
import { useApp } from "./useApp";

export function refuseMirrorEdit(reason: string): void {
  useApp.getState().setStatus(reason, "danger");
  toast(reason, "danger");
}

/** The mirror reasons and source names, worded against the live worksheets so a source column
 *  is named by its label, not its letter. Components call these rather than read the store. */
export const mirrorEditWhy = (ds: Dataset, col: number): string | null => mirrorEditReason(ds, col, useApp.getState().datasets);
export const mirrorBlockWhy = (ds: Dataset, cols: readonly number[], baseCount: number): string | null =>
  mirrorBlockReason(ds, cols, baseCount, useApp.getState().datasets);
export const mirrorSourceName = (link: MirrorLink): string => mirrorSourceText(link, useApp.getState().datasets);
