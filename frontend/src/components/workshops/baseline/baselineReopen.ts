// "Open in Baseline" (lane RO): the recorded method, knobs and anchors of a
// committed Baseline-subtract result, read back from its envelope settings.
// The plotted channels (`binding`) are restored by the opener
// (store/toolReopenOpen.ts), since the estimate follows the plot's selection.

import type { ReopenSeed } from "../../../lib/committedOutputReopen";
import { seedChoice, seedNumber } from "../resultcommit/useReopenSession";
import { BASELINE_METHODS, type BaselineMethod } from "./baselineMethods";
import type { BaselineParams } from "./useBaseline";

export interface BaselineSeed {
  method: BaselineMethod;
  params: BaselineParams;
  anchors: [number, number][];
}

export function baselineSeed(settings: ReopenSeed | undefined, defaults: BaselineParams): BaselineSeed | null {
  if (!settings) return null;
  const raw = settings["params"];
  const recorded = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const params = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof BaselineParams)[]) {
    if (key === "anchorMethod") params.anchorMethod = typeof recorded.anchorMethod === "string" ? recorded.anchorMethod : defaults.anchorMethod;
    // A NaN edge ("no bound") is recorded as null.
    else if (key in recorded) params[key] = seedNumber(recorded[key], defaults[key]);
  }
  const anchors = Array.isArray(settings["anchors"])
    ? settings["anchors"].filter((pt): pt is [number, number] =>
      Array.isArray(pt) && pt.length === 2 && typeof pt[0] === "number" && typeof pt[1] === "number")
    : [];
  return { method: seedChoice(settings["method"], BASELINE_METHODS, "als"), params, anchors };
}
