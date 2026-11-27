// The one place a refused edit of a mirror column is worded to the user: the
// status line AND a toast (a status line alone reads as "nothing happened",
// the lesson of store/sortRows.ts's refuseRowOrder). Tiny and separate so the
// cell cursor and the cell-edit store body share it without either importing
// the other.

import { toast } from "./toasts";
import { useApp } from "./useApp";

export function refuseMirrorEdit(reason: string): void {
  useApp.getState().setStatus(reason, "danger");
  toast(reason, "danger");
}
