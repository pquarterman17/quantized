// The figure the quick Export dialog will write (audit A2/D2). Publication
// Preview names its target ("Export figure — circle.csv"); the quick dialog
// used to name none, so with a Library row selected and another plot focused
// the user could not tell which would be written. Selecting a Library item
// never retargets (only opening it does), so the target is the ACTIVE
// dataset -- the same one `exportActive` and the Preview's draft resolve --
// captured when the dialog opens and re-checked when it closes.

import type { StoreGet } from "./exportActive";
import { toast } from "../store/toasts";

export interface ExportTarget {
  id: string;
  /** Dialog title, e.g. "Export figure — circle.csv". */
  title: string;
}

/** The active dataset as the export target, or null when none. */
export function exportTarget(s: StoreGet): ExportTarget | null {
  const st = s();
  const d = st.datasets.find((x) => x.id === st.activeId);
  return d ? { id: d.id, title: `Export figure — ${d.name}` } : null;
}

/** False (with a status + toast) when the active plot changed while the
 *  dialog was open: the file must be the figure the dialog named. */
export function targetStillActive(s: StoreGet, target: ExportTarget): boolean {
  if (s().activeId === target.id) return true;
  const msg = "Export cancelled: the active plot changed while the dialog was open.";
  s().setStatus(msg);
  toast(msg, "info");
  return false;
}
