// Writes a plot-setup plan (lib/plotSetup.ts) through the store actions the
// plot already uses -- setXKey, setYKeys, setErrorRoles, setPointLabels -- as
// ONE undo step. Lazy (the role grid's only caller).

import { DEFAULT_TOP_N } from "../../../lib/pointLabels";
import type { PlotSetupPlan } from "../../../lib/plotSetup";
import { confirmErrorBindings } from "../../../lib/errorRoleConfirm";
import { commitErrorRoles } from "../../workshops/graphbuilder/errorRolesCommit";
import { asOneEditStep } from "../../../store/undoStep";
import { plotIntentStageTab, useApp } from "../../../store/useApp";

/** Apply `plan` to dataset `id`: rebinds the plot to it first when another
 *  dataset is focused (the explicit plot intent), then sets the roles. */
export function applyPlotSetup(id: string, plan: PlotSetupPlan): void {
  const get = useApp.getState;
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  if (get().activeId !== id) get().setActive(id);
  const tab = plotIntentStageTab(ds);
  if (get().stageTab !== tab) useApp.setState({ stageTab: tab });
  asOneEditStep(get, "plot setup", () => {
    const s = get();
    s.setXKey(plan.xKey);
    s.setYKeys(plan.yKeys);
    if (plan.errorRoles) {
      commitErrorRoles(get(), id, plan.errorRoles);
      confirmErrorBindings(id, plan.decided);
    }
    if (plan.label !== "keep") {
      const was = get().pointLabels;
      s.setPointLabels(plan.label === null ? null : { mode: "all", topN: DEFAULT_TOP_N, ...(was && !was.text ? was : {}), key: plan.label });
    }
  });
  get().setStatus(`plot setup: ${plan.yKeys.length} Y column${plan.yKeys.length === 1 ? "" : "s"}`);
}
