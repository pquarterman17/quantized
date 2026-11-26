// Carry out a worksheet-open intent (store/worksheetOpen.ts) in the window layout
// and say so: the store half (store/windowLayoutWorksheet.ts) opens or raises the
// dataset's worksheet window; this adds the live-region sentence and the focus.

import { plotRef } from "../../../lib/windowLayout/refs";
import { openWorksheetWindowFor } from "../../../store/windowLayoutWorksheet";
import type { WorksheetOpenIntent } from "../../../store/worksheetOpen";
import { announce } from "./layoutAnnounce";
import { focusTitleBar } from "./useLayoutKeyboard";

export function openWorksheetWindow(intent: WorksheetOpenIntent, say = true): void {
  const result = openWorksheetWindowFor(intent);
  if (!result) return;
  if (say) announce(`Worksheet ${result.name} ${result.existed ? "brought forward" : "opened in a window"}.`);
  requestAnimationFrame(() => focusTitleBar(plotRef(result.id)));
}
