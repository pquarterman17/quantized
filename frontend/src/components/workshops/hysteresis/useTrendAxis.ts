// Hysteresis comparison: the trend-axis settings (series source, label, unit)
// and the per-worksheet values typed under them, moved out of the batch
// section so the preset adapter and the section read ONE state.

import { useState } from "react";

import type { HysteresisTrendCandidate } from "../../../lib/hysteresisTrend";

/** The source select's two fixed entries; every other entry is a candidate's `key`. */
export const TREND_NONE = "";
export const TREND_MANUAL = "__manual__";

export function useTrendAxis(candidates: readonly HysteresisTrendCandidate[]) {
  const [axisSource, setAxisSource] = useState(TREND_NONE);
  const [axisLabel, setAxisLabel] = useState("");
  const [axisUnit, setAxisUnit] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  /** The user's choice of source: its label and unit start from the candidate's, and typed values are dropped. */
  const choose = (source: string): void => {
    setAxisSource(source);
    setOverrides({});
    if (!source) {
      setAxisLabel(""); setAxisUnit("");
    } else if (source === TREND_MANUAL) {
      setAxisLabel("Series variable"); setAxisUnit("");
    } else {
      const candidate = candidates.find((item) => item.key === source);
      setAxisLabel(candidate?.label ?? "Series variable");
      setAxisUnit(candidate?.units.length === 1 ? candidate.units[0] : "");
    }
  };

  /** A preset's Apply: the three settings exactly as stored (typed values are kept while the source is unchanged). */
  const applyAxis = (source: string, label: string, unit: string): void => {
    if (source !== axisSource) setOverrides({});
    setAxisSource(source); setAxisLabel(label); setAxisUnit(unit);
  };

  return { axisSource, axisLabel, axisUnit, overrides, setOverrides, setAxisLabel, setAxisUnit, choose, applyAxis };
}
