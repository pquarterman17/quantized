// Re-render a display component when the Numbers prefs change (decimal
// separator, grouping, thresholds, ...): the formatters are plain functions,
// so a surface that prints through them subscribes here.

import { useSyncExternalStore } from "react";

import { fmtCfg } from "./format";

const subscribe = (f: () => void): (() => void) => (fmtCfg.s.add(f), () => fmtCfg.s.delete(f));
export const useFormatEpoch = (): unknown => useSyncExternalStore(subscribe, () => fmtCfg.s);
