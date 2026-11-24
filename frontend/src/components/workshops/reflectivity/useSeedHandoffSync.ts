// Film-stack hand-off bookkeeping for the fit (split out of useReflFit to keep
// it under the module ceiling). A hand-off is a new model: stale bounds / ties /
// vary from the old one must not carry over (a same-length stack would keep
// them, buildParamRows only drops overrides when the layer count changes), and
// held overrides make the model "touched" for the hand-off's replace confirm.

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import type { ParamOverrides } from "./reflFitModel";
import type { ReflModelHandle } from "./useReflFit";

export function useSeedHandoffSync(
  model: ReflModelHandle,
  overrides: ParamOverrides,
  setOverrides: Dispatch<SetStateAction<ParamOverrides>>,
): void {
  const count = model.layers.length;
  const epoch = model.seedEpoch ?? 0;
  const lastEpoch = useRef(epoch);
  useEffect(() => {
    if (lastEpoch.current === epoch) return;
    lastEpoch.current = epoch;
    setOverrides({ layerCount: count, byName: {} });
  }, [epoch, count, setOverrides]);
  const dirty = model.fitOverridesDirty;
  useEffect(() => {
    if (dirty) dirty.current = overrides.layerCount === count && Object.keys(overrides.byName).length > 0;
  }, [dirty, overrides, count]);
}
