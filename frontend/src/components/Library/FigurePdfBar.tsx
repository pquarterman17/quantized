// "Export PDF (N)": the ticked editable figures as ONE multi-page PDF, one page
// per figure in tick order, through the batch route (store/exportSavedFigures).
// Lazy-loaded by LibrarySections once something is ticked.

import { useState } from "react";

import { onLoadFailure, runLazy } from "../../lib/runLazy";
import { useFigurePdfTicks } from "../../store/figurePdfTicks";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

export default function FigurePdfBar() {
  const ids = useFigurePdfTicks((s) => s.ids);
  const clear = useFigurePdfTicks((s) => s.clear);
  const existing = useApp((s) => s.editableFigures);
  const [exporting, setExporting] = useState(false);
  const live = ids.filter((id) => existing.some((figure) => figure.id === id));
  if (live.length === 0) return null;

  const exportPdf = () => {
    setExporting(true);
    void runLazy("Loading figure export…", () => import("../../store/exportSavedFigures"))
      .then((m) => m.exportSavedFiguresPdf(live, "figures"), onLoadFailure)
      .then((n) => {
        if (n) toast(`exported ${n} figure${n === 1 ? "" : "s"} as one PDF`);
      })
      .catch((error: unknown) => toast(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`, "danger"))
      .finally(() => setExporting(false));
  };

  return (
    <div className="qzk-fig-row" style={{ gap: 6 }}>
      <button
        className="qz-btn qz-sm"
        disabled={exporting}
        aria-label={`Export ${live.length} figure${live.length === 1 ? "" : "s"} as one PDF`}
        title="one multi-page PDF, one page per ticked figure, in the order you ticked them"
        onClick={exportPdf}
      >
        Export PDF ({live.length})
      </button>
      <button className="qz-btn qz-ghost qz-sm" aria-label="Clear PDF selection" onClick={clear}>Clear</button>
    </div>
  );
}
