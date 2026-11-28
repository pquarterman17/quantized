// The Plot menu / palette "Argand plot" and "Nyquist plot" (commands/complexPairCommands.ts): the
// pair is found from the active worksheet and the columns the plot shows (lib/complexPair.ts), then
// plotted exactly as the worksheet column menu's entries do (store/complexPairPlot.ts). A refusal,
// of either step, is said in the status line and changes nothing. Lazy: loaded on use.

import { pairIdForSelection } from "../lib/complexPair";
import { plotIntentStageTab } from "../lib/stagetab";
import { plotComplexPair, type PairPlotKind } from "./complexPairPlot";
import { useApp } from "./useApp";

export async function plotPairFromSelection(kind: PairPlotKind): Promise<void> {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) return s.setStatus("Can't plot the pair: no worksheet is active", "danger");
  const found = pairIdForSelection(ds, s.xKey, s.yKeys);
  if ("error" in found) return s.setStatus(`Can't plot the pair: ${found.error}`, "danger");
  // As the worksheet's own plot actions: a plot action shows the plot.
  const tab = plotIntentStageTab(ds);
  if (s.stageTab !== tab) useApp.setState({ stageTab: tab });
  const now = useApp.getState();
  await plotComplexPair(ds.id, found.id, kind, { setXKey: now.setXKey, setYKeys: now.setYKeys });
}
