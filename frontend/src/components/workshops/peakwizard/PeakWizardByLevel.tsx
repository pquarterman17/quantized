// Peak analyzer "By": the wizard's recipe baseline + peak find run once per
// level of a categorical column (summary: peaks found, strongest peak).
// Display-only and detection-only: ranges, model fits and the report stay on
// the whole worksheet. Uses the very functions the wizard and its batch run
// (./recipeSteps), so a level is found exactly as the wizard would find it.

import { useCallback } from "react";

import type { PeakRecipe } from "../../../lib/peakwizard";
import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import { levelPairs } from "../byrun/byLevelPairs";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePlottedPair } from "../byrun/usePlottedPair";
import { recipeBaseline, recipeFind } from "./recipeSteps";

export default function PeakWizardByLevel({ recipe }: { recipe: PeakRecipe }) {
  const { active, data, xKey, yKey, columns } = usePlottedPair();
  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    if (!active || yKey == null) throw new Error("select a plotted Y channel first");
    const { x, y } = levelPairs(active, level.data, xKey, yKey);
    if (x.length < 3) throw new Error(`not enough data (n=${x.length})`);
    const baseline = await recipeBaseline(x, y, recipe.baseline);
    const working = baseline ? y.map((v, i) => v - (baseline[i] ?? 0)) : y;
    const peaks = await recipeFind(x, working, recipe.find);
    const top = peaks.reduce<(typeof peaks)[number] | null>((b, p) => (!b || p.prominence > b.prominence ? p : b), null);
    return [peaks.length, top?.center ?? null, top?.localSNR ?? null];
  }, [active, xKey, yKey, recipe]);
  return (
    <ByLevelRunSection
      tool="Peak analyzer"
      active={active}
      data={data}
      columns={columns}
      headers={["Peaks", "Strongest center", "Strongest SNR"]}
      run={run}
      runKey={`${xKey}|${yKey}|${JSON.stringify(recipe.baseline)}|${JSON.stringify(recipe.find)}`}
      blockedReason={active?.pending ? "wait for the full dataset to load" : null}
      save={{ toolId: "peak-wizard", parameters: { baseline: { ...recipe.baseline }, find: { ...recipe.find } }, xKey, yKeys: yKey == null ? [] : [yKey] }}
    />
  );
}
