// The prediction profiler (GAP_AUDIT_9 G7) as a saved snapshot result (owner
// decision 2026-11-25). A profile evaluates a SAVED Fit Model result: the
// envelope records that result's id and a digest of its model (fitModelDigest),
// shares its source and the data fingerprint it was fitted on, and carries the
// factor settings, confidence level and desirability goal. The profile goes
// out of date when the Fit Model result (or its data) changes and is "source
// missing" when that result is deleted (lib/analysisResultFreshness.ts). A live
// fit that was never saved cannot be profiled into a result (fail closed).
// Pure; imported by the lazy Profiler workshop only.

import type { ProfileResponse } from "./api/modelEvaluate";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable, type AnalysisResultValue } from "./analysisResult";
import { fmtNum } from "./format";
import { INPUTS_PARAM, recordedInputs } from "./resultInputsRecord";
import { PROFILER_RESULT, type ProfilerRecipe } from "./toolResultKinds";
import type { Dataset } from "./types";
import { boundedTables } from "./variabilityAnalysisResult";

/** Bumped when calc/profile_model.py's method changes (provisional, owner to confirm). */
export const PROFILER_ALGORITHM_VERSION = 1;

export const PROFILER_TABLES = { current: "Current prediction", settings: "Factor settings" } as const;
export const traceTitle = (factor: string): string => `Prediction trace: ${factor}`;

const nul = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function profilerResultTables(profile: ProfileResponse): AnalysisResultTable[] {
  const c = profile.current;
  const level = `${fmtNum((1 - profile.alpha) * 100)}%`;
  const goal = profile.factors.some((t) => t.desirability);
  const tables: AnalysisResultTable[] = [
    { title: PROFILER_TABLES.current, columns: ["statistic", "value"], rows: [
      ["Predicted", nul(c.predicted)], ["Std error (mean)", nul(c.se)], [`Lower ${level}`, nul(c.lower)], [`Upper ${level}`, nul(c.upper)],
      ["t critical", nul(profile.t_crit)], ["Error df", nul(profile.df_error)], ["RMSE", nul(profile.rmse)],
      ...(c.desirability !== undefined ? [["Desirability", nul(c.desirability)] as [string, number | null]] : []),
    ] },
    { title: PROFILER_TABLES.settings, columns: ["factor", "kind", "value", "level"],
      rows: profile.factors.map((t) => {
        const v = c.settings[t.name];
        return t.kind === "continuous" ? [t.name, "continuous", nul(typeof v === "number" ? v : null), null]
          : [t.name, "nominal", null, typeof v === "string" ? v : "averaged over levels"];
      }) },
  ];
  for (const t of profile.factors) {
    const xs: (string | number | null)[] = t.kind === "continuous" ? t.x.map(nul) : t.levels;
    tables.push({ title: traceTitle(t.name),
      columns: [t.kind === "continuous" ? t.name : `${t.name} level`, "predicted", "s.e.", `lower ${level}`, `upper ${level}`, ...(goal ? ["desirability"] : [])],
      rows: xs.map((x, i) => [x, nul(t.predicted[i]), nul(t.se[i]), nul(t.lower[i]), nul(t.upper[i]), ...(goal ? [nul(t.desirability?.[i])] : [])]) });
  }
  return tables;
}

export function profilerAnalysisResult(
  id: string, fit: AnalysisResult, recipe: ProfilerRecipe, profile: ProfileResponse, createdAt = new Date().toISOString(),
  /** The Fit Model result's source, recorded when that result predates its own inputs record. */
  source?: Dataset,
): AnalysisResult {
  const bounded = boundedTables(profilerResultTables(profile));
  const c = profile.current;
  const inputs = fit.parameters?.[INPUTS_PARAM] ?? (source ? recordedInputs([source], { xKey: undefined }) : undefined);
  return {
    version: ANALYSIS_RESULT_VERSION, id,
    name: `${profile.response} profile · ${fit.name}`,
    producer: { id: PROFILER_RESULT, label: "Profiler", version: 1 },
    // The Fit Model result's source and the data state it was fitted on.
    sources: fit.sources.map((s) => ({ ...s })), outputs: [],
    ...(fit.selection ? { selection: fit.selection } : {}),
    ...(fit.sourceFingerprint ? { sourceFingerprint: fit.sourceFingerprint } : {}),
    scalarValues: {
      Test: "Prediction profiler", Response: profile.response, "Fit Model result": fit.name,
      Interpretation: `${profile.response} = ${fmtNum(c.predicted)} (${fmtNum((1 - profile.alpha) * 100)}% CI ${fmtNum(c.lower)} to ${fmtNum(c.upper)}) at the saved settings.`,
      Predicted: nul(c.predicted), Alpha: profile.alpha,
    },
    parameters: {
      recipe: { fitResultId: recipe.fitResultId, fitDigest: recipe.fitDigest, settings: recipe.settings, alpha: recipe.alpha,
        goal: recipe.goal as AnalysisResultValue },
      algorithm: { id: "profile-model", version: PROFILER_ALGORITHM_VERSION },
      ...(inputs !== undefined ? { [INPUTS_PARAM]: inputs } : {}),
    },
    tables: bounded.tables, warnings: [...bounded.warnings], createdAt,
  };
}
