// Help > Tip of the day: one tip at a time with Previous / Next, the exact menu
// path, and "Show at start" (Preferences ▸ General has the same switch). Off by
// default: nothing opens on launch until the user turns it on.

import { tipAt, TIPS } from "../../../lib/learning/tips";
import { workflowPrefsSlot } from "../../../lib/workflowPrefs";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { Button } from "../../primitives";
import { Switch } from "../../primitives/Switch";
import LearningModal from "./LearningModal";

const wrap = (i: number): number => ((Math.trunc(i) % TIPS.length) + TIPS.length) % TIPS.length;

export default function TipDialog({ onClose }: { onClose: () => void }) {
  const prefs = workflowPrefsSlot.use();
  const at = wrap(prefs.tipIndex);
  const tip = tipAt(at);
  const go = (by: number) => setWorkflowPrefs({ tipIndex: wrap(at + by) });
  return (
    <LearningModal
      title="Tip of the day"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => go(-1)}>Previous</Button>
          <Button onClick={() => go(1)}>Next</Button>
        </>
      }
    >
      <h3 style={{ margin: "4px 0" }}>{tip.title}</h3>
      <p>{tip.body}</p>
      <p className="qzk-helptext">Find it: <strong>{tip.path}</strong></p>
      <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
        <Switch aria-label="Show at start" checked={prefs.showTipAtStart} onChange={(v) => setWorkflowPrefs({ showTipAtStart: v })} />
        Show at start
      </label>
      <p className="qzk-helptext">{at + 1} of {TIPS.length}</p>
    </LearningModal>
  );
}
