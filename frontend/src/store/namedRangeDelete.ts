// Delete a named range through the dependants dialog (ROW_RANGE_CONTRACT 5.3, decision D10): a range nothing uses goes at
// once; one with dependants lists them, and only a confirmed delete cuts their links (they then show "named range
// removed" and never re-bind to a later range of the same name). One undo step restores the range and every link.

import { removeNamedRange } from "./namedRanges";
import { askConfirm } from "./confirmDialog";
import { useApp } from "./useApp";

/** Returns true when the range was deleted. */
export async function deleteNamedRangeFlow(id: string): Promise<boolean> {
  const name = useApp.getState().namedRanges.find((r) => r.id === id)?.name ?? "";
  const first = removeNamedRange(id);
  if (first.removed) return true;
  if (!("dependants" in first)) {
    useApp.getState().setStatus(`named range: ${first.reason}`);
    return false;
  }
  const n = first.dependants.length;
  const list = first.dependants.map((d) => `${d.kind}: ${d.label}`).join("\n");
  const ok = await askConfirm(
    `Delete named range "${name}"?`,
    `${n} thing${n === 1 ? " uses" : "s use"} it:\n${list}\n\nThey will show "named range removed" and will not pick up another range with the same name. Undo brings the range and its links back.`,
    "Delete",
    true,
  );
  if (!ok) return false;
  // Dependants may have changed while the dialog was open: confirming covers the ones that were listed, so re-check.
  const again = removeNamedRange(id);
  if (again.removed) return true;
  if ("dependants" in again && again.dependants.length <= n) return removeNamedRange(id, { confirmed: true }).removed;
  useApp.getState().setStatus("named range: its dependants changed while the dialog was open; nothing was deleted");
  return false;
}
