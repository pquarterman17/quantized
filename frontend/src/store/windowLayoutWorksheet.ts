// A worksheet DOCUMENT window for the window layout (the Worksheet counterpart of
// ./windowLayoutMap). Carries out store/worksheetOpen.ts's intent: the dataset's
// worksheet window is created (docked in the centre, or floating on a screen under
// SMALL_SCREEN_PX) or, when one is already bound to it, brought forward. It never
// touches `activeId`, the Data window's pin or the focused plot: Data may be pinned
// to another sheet, so the new sheet gets a window of its own beside it (fail closed
// instead of silently replacing what the user pinned).

import { float } from "../lib/windowLayout/ops";
import { plotRef } from "../lib/windowLayout/refs";
import { SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { useApp } from "./useApp";
import { applyLayout, reopenRef } from "./windowLayoutActions";
import type { WorksheetOpenIntent } from "./worksheetOpen";

/** Open (or raise) the dataset's worksheet window and select the rows; null for an unknown dataset. */
export function openWorksheetWindowFor({ datasetId, rowIds }: WorksheetOpenIntent): { id: string; name: string; existed: boolean } | null {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === datasetId);
  if (!ds) return null;
  const existing = s.plotWindows.find((w) => w.kind === "worksheet" && w.datasetId === ds.id);
  const id = existing?.id ?? s.createDocumentWindow("worksheet", ds.id);
  const ref = plotRef(id);
  if (!existing && typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_PX) applyLayout((l) => float(l, ref), false);
  else reopenRef(ref, false); // opening a window is not a layout edit
  const app = useApp.getState();
  app.raiseWindow(id);
  app.ensureBookData(ds.id);
  if (rowIds?.length) {
    app.setWorksheetRowSelection(id, ds.id, [...rowIds]);
    // The plot's own (linked) selection too, when the sheet is the plotted data: Go to Source highlights it there.
    if (ds.id === app.activeId) app.setRowSelection([...rowIds]);
  }
  return { id, name: ds.name, existed: existing !== undefined };
}
