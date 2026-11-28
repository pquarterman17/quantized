// The always-mounted, lazy host of the learning aids (plan item 45). Loads
// after first paint with the other overlay panels; on mount it starts the hint
// log and, only when the user turned "Show at start" on, opens the tip of the
// day once. Renders whichever dialog store/learningDialogs says is open.

import { useEffect } from "react";

import { workflowPrefsSlot } from "../../../lib/workflowPrefs";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { startHintLog } from "../../../store/hintLog";
import { useLearningDialogs } from "../../../store/learningDialogs";
import RecentHintsDialog from "./RecentHintsDialog";
import SampleGallery from "./SampleGallery";
import TipDialog from "./TipDialog";

let startupTipHandled = false;

/** Test seam: the once-per-page-load startup check is module state. */
export function resetStartupTipForTests(): void {
  startupTipHandled = false;
}

export default function LearningHost() {
  const open = useLearningDialogs((s) => s.open);
  const close = useLearningDialogs((s) => s.close);
  useEffect(() => {
    const stop = startHintLog();
    if (!startupTipHandled) {
      startupTipHandled = true;
      const prefs = workflowPrefsSlot.load();
      if (prefs.showTipAtStart) {
        setWorkflowPrefs({ tipIndex: prefs.tipIndex + 1 }); // a different tip each launch
        useLearningDialogs.getState().show("tips");
      }
    }
    return stop;
  }, []);
  if (open === "hints") return <RecentHintsDialog onClose={close} />;
  if (open === "gallery") return <SampleGallery onClose={close} />;
  if (open === "tips") return <TipDialog onClose={close} />;
  return null;
}
