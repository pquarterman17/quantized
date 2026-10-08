// The ONE lazy chunk the Signal Processing workbench and the durable
// analysis-result workspace mount through (the AuxFigurePanels precedent):
// AppOverlays gates it on either open flag, so the eager bundle pays one
// preload stub and one deps list for the pair rather than two. Each panel
// stays gated on its own flag inside the chunk.

import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "../signalprocessing/SignalProcessingPanel";
import AnalysisResultPanel from "./AnalysisResultPanel";

export default function SignalAnalysisPanels() {
  const signalOpen = useApp((s) => s.signalProcessingOpen);
  const resultOpen = useApp((s) => s.openAnalysisResultId !== null);
  return (
    <>
      {signalOpen && <SignalProcessingPanel />}
      {resultOpen && <AnalysisResultPanel />}
    </>
  );
}
