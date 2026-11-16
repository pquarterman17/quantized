// Bodies of the Origin keyboard habits that open a lazy feature (audit-6 lane O):
// Ctrl+N = New workbook, Ctrl+J = Copy figure, F2 = rename the selected (else
// active) dataset. Key detection lives eagerly in useGlobalShortcuts.ts; this
// lazy chunk keeps the bodies, and the loads they trigger, off the eager bundle.
// (Measured: routing these through new palette commands instead cost more eager
// bytes than this one chunk.)

import { useApp } from "../store/useApp";
import { RENAME_ACTIVE_EVENT } from "./renameActive";
import { onLoadFailure, runLazy } from "./runLazy";

export function originKey(key: string): void {
  if (key === "n") {
    void runLazy("Opening a new workbook…", () => import("../store/newWorkbook")).then((m) => m.newWorkbook(), onLoadFailure);
  } else if (key === "j") {
    void runLazy("Loading figure copy…", () => import("./copyFigureCommand")).then((m) => m.runCopyFigureCommand(useApp.getState), onLoadFailure);
  } else if (key === "f2") {
    // Library rows answer the event; the one whose dataset id matches claims it (once),
    // so a dataset listed twice (tree + smart folder) opens a single rename box.
    const s = useApp.getState();
    const ask = { id: s.selectedIds.length === 1 ? s.selectedIds[0] : s.activeId, hit: false };
    window.dispatchEvent(new CustomEvent(RENAME_ACTIVE_EVENT, { detail: ask }));
    if (!ask.hit) s.setStatus("F2: show the dataset in the Library to rename it");
  }
}
