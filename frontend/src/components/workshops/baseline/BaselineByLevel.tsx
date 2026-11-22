// Baseline "By": the chosen method and settings estimated once per level of a
// categorical column (summary: baseline range and the residual after it).
// Display-only: nothing is subtracted or overlaid. The anchor method is placed
// by hand on one curve, so it has no per-level meaning.

import { useCallback } from "react";

import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import { levelPairs } from "../byrun/byLevelPairs";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePlottedPair } from "../byrun/usePlottedPair";
import { callBaseline } from "./baselineCall";
import { BASELINE_SUMMARY_HEADERS, baselineSummary } from "./baselineSummary";
import type { BaselineState } from "./useBaseline";

export default function BaselineByLevel({ b }: { b: Pick<BaselineState, "method" | "params"> }) {
  const { active, data, xKey, yKey, columns } = usePlottedPair();
  const { method, params } = b;
  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    if (!active || yKey == null) throw new Error("select a plotted Y channel first");
    const { x, y } = levelPairs(active, level.data, xKey, yKey);
    if (x.length < 3) throw new Error(`not enough data (n=${x.length})`);
    const { baseline } = await callBaseline(method, x, y, params, []);
    return [...baselineSummary(y, baseline)];
  }, [active, xKey, yKey, method, params]);
  return (
    <ByLevelRunSection
      tool="Baseline"
      active={active}
      data={data}
      columns={columns}
      headers={BASELINE_SUMMARY_HEADERS}
      run={run}
      runKey={`${xKey}|${yKey}|${method}|${JSON.stringify(params)}`}
      blockedReason={active?.pending ? "wait for the full dataset to load" : method === "anchor" ? "anchor baselines are placed by hand on one curve" : null}
    />
  );
}
