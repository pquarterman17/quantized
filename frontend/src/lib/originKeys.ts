// Bodies of the Origin keyboard habits (audit-6 lane O): Ctrl+R = Rescale (the
// plot's autoscale), Ctrl+N = New workbook, Ctrl+J = Copy figure. The key
// detection and preventDefault live eagerly in useGlobalShortcuts.ts; this
// module (a lazy chunk) keeps the bodies, and the loads they trigger, off the
// eager bundle, exactly as the matching File / Plot commands do.

import { useApp } from "../store/useApp";
import { RENAME_ACTIVE_EVENT } from "./renameActive";
import { onLoadFailure, runLazy } from "./runLazy";

export function originKey(key: string): void {
  if (key === "r") {
    const s = useApp.getState();
    if (s.xLim || s.yLim || s.y2Lim) s.recordView({ xLim: s.xLim, yLim: s.yLim, y2Lim: s.y2Lim }, { xLim: null, yLim: null, y2Lim: null });
  } else if (key === "n") {
    void runLazy("Opening a new workbook…", () => import("../store/newWorkbook")).then((m) => m.newWorkbook(), onLoadFailure);
  } else if (key === "f2") {
    window.dispatchEvent(new Event(RENAME_ACTIVE_EVENT)); // the active Library row starts renaming
  } else if (key === "j") {
    void runLazy("Loading figure copy…", () => import("./copyFigureCommand")).then((m) => m.runCopyFigureCommand(useApp.getState), onLoadFailure);
  }
}
