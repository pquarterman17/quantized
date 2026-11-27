// Baseline's preset bar: the shared bar over the Baseline adapter. Mounted by
// BaselinePanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createBaselineAdapter } from "./presetAdapter";
import type { BaselineState } from "./useBaseline";

export default function BaselinePresetBar({ b, fromResult }: { b: Pick<BaselineState, "method" | "params" | "setMethod" | "setParams" | "busy">; fromResult: boolean }) {
  const adapter = createBaselineAdapter({
    getMethod: () => b.method, getParams: () => b.params, setMethod: b.setMethod, setParams: b.setParams,
  });
  return <PresetBar adapter={adapter} fromResult={fromResult} running={b.busy} />;
}
