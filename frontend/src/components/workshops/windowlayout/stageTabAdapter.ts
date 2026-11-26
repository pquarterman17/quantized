// The ONE adapter from classic stage-tab requests to the window layout (plan
// "Migration of existing users", P4 + P5). Windows mode has no stage tabs, but
// many actions still ask for one through `setStageTab` / `stageTab:` patches
// (store/datasetSelection.ts, store/analysisCenterRun.ts,
// store/analysisResultPlotOpen.ts, store/firstPlotNotice.ts, lib/scatteredContour.ts,
// ...). While the layout host is mounted this hook takes each request, routes it
// to the matching window and puts the tab back to "plot" at once (the Style
// window's cards follow the stage tab):
// - "map" (P5): the active dataset's MAP WINDOW, a plot-family window
//   (`kind: "map"`) whose body is MapStage with its own toolbar on the plot. The
//   dataset's open map window is brought forward; otherwise one is created and
//   placed: docked in the centre, or floating on a screen under SMALL_SCREEN_PX
//   (D6). A dataset that cannot be drawn as a map opens nothing and says so.
// - "technique" / "analysis": the Analysis window (P4), except an Origin
//   migration review, which is not in the layout yet;
// - "worksheet": the shared worksheet-open intent (store/worksheetOpen.ts), which this
//   host answers with a worksheet window (./openWorksheetWindow) for the Library's
//   worksheet target. Explicit opens (New Workbook, Open as worksheet, Go to Source)
//   call the intent directly and never come through here;
// - an Origin migration review: `onPending(view)`, the toolbar's notice that
//   offers the classic layout (fail closed instead of silently doing nothing).

import { useEffect, useRef } from "react";

import { useWorkflowWorkspaceView } from "../../../lib/workflowWorkspace";
import { useApp } from "../../../store/useApp";
import { reopenRef } from "../../../store/windowLayoutActions";
import { setWorksheetWindowHandler } from "../../../store/worksheetOpen";
import { openMapWindow } from "./openMapWindow";
import { openWorksheetWindow } from "./openWorksheetWindow";

const PENDING_VIEW: Record<string, string> = { technique: "Workflow" };

export function useStageTabAdapter(onPending: (view: string) => void): void {
  const stageTab = useApp((s) => s.stageTab);
  const setStageTab = useApp((s) => s.setStageTab);
  const worksheetId = useApp((s) => s.worksheetId);
  const activeId = useApp((s) => s.activeId);
  const workflowView = useWorkflowWorkspaceView();
  // An Origin review is a NEW request only once per request id: the session's view stays "origin"
  // afterwards (nothing here renders the review to reset it), and a later Show workflow is the guide.
  const handledReview = useRef<number | null>(null);
  // The request in force when the host mounts is a restore replaying (a reload, or switching the layout
  // on while the Map tab was up): it opens or raises the window but says nothing (UX pass 4 m-9).
  const mounted = useRef(false);
  // While the host is mounted the worksheet-open intent opens a worksheet window.
  useEffect(() => setWorksheetWindowHandler((intent) => openWorksheetWindow(intent)), []);
  useEffect(() => {
    const restoring = !mounted.current;
    mounted.current = true;
    const review = stageTab === "technique" && workflowView.kind === "origin" && workflowView.requestId !== handledReview.current;
    if (review && workflowView.kind === "origin") handledReview.current = workflowView.requestId;
    if (stageTab === "analysis" || (stageTab === "technique" && !review)) {
      reopenRef("analysis");
      setStageTab("plot");
      return;
    }
    if (stageTab === "map") {
      setStageTab("plot");
      void openMapWindow({ say: !restoring });
      return;
    }
    if (stageTab === "worksheet") {
      // A bare View > Worksheet request: the sheet the Library's worksheet target names.
      setStageTab("plot");
      const datasetId = worksheetId ?? activeId;
      if (datasetId) openWorksheetWindow({ datasetId }, !restoring);
      return;
    }
    const view = PENDING_VIEW[stageTab];
    if (!view) return;
    onPending(view);
    setStageTab("plot");
  }, [stageTab, setStageTab, workflowView, onPending, worksheetId, activeId]);
}
