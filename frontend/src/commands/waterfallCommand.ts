// UX9-D "One waterfall": the single entry for drawing a waterfall. Plot ▸
// Layout ▸ Waterfall…, the palette ("waterfall", "offset") and the Plot-type
// gallery all call applyWaterfall(); the Channels card slider writes the same
// store field (`waterfall`, a fraction of the y-span). The old tool window now
// only exports the stacked data (CSV / 3-D) -- "waterfall-export".

import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { effectiveChannels } from "../lib/plotdata";
import { snapshotOf } from "../store/historySnapshot";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";

/** The offset a fresh waterfall starts at (the audited slider "feel", 30 %). */
export const DEFAULT_WATERFALL = 0.3;

/** window event the Channels card listens for: open the card, show the slider. */
export const REVEAL_WATERFALL_EVENT = "qz:reveal-waterfall";

/** Plot the selection together (>=2 datasets), set the offset, and reveal the
 *  slider. With <2 selected it stacks the focused graph's own curves. */
export async function applyWaterfall(): Promise<void> {
  // One gesture, one undo step: the overlay graph and the offset fold into a
  // single entry holding the state from before (store/undoStep.ts's pattern;
  // nothing recorded -> nothing folded, so a refusal leaves the stack alone).
  const history = useApp.getState().history;
  const sinceSeq = history[history.length - 1]?.seq;
  const snapshot = snapshotOf(useApp.getState());
  try {
    await runWaterfall();
  } finally {
    useApp.getState().foldHistorySince(sinceSeq, "waterfall", snapshot);
  }
}

async function runWaterfall(): Promise<void> {
  const before = useApp.getState();
  if (before.selectedIds.length >= 2) {
    const prior = before.datasets.length;
    await plotSelectedTogether(before.selectedIds);
    // The shim toasts its own refusal; stop when no graph landed.
    if (useApp.getState().datasets.length <= prior) return;
  }
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) {
    toast("select 2 or more datasets in the Library first", "danger");
    return;
  }
  const curves = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder).length;
  if (curves < 2) {
    toast("a waterfall stacks 2 or more curves: select 2 or more datasets in the Library first", "danger");
    return;
  }
  if (s.waterfall === 0) s.setWaterfall(DEFAULT_WATERFALL);
  s.setStageTab("plot");
  window.dispatchEvent(new Event(REVEAL_WATERFALL_EVENT));
}
