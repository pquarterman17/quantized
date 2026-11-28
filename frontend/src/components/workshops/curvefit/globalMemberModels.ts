// Curve Fit — Global fit with ONE MODEL PER SERIES (Origin's multi-output
// models), pure helpers. Each picked series can take its own registry model;
// the parameter table is then the UNION of every model's parameter names, and a
// parameter is shared only when its "shared" box is ticked (a same-named
// parameter in two models is otherwise two independent parameters). The route
// (`dataset_models`) refuses a share that some series' model cannot honour.
//
// Start / bounds are keyed by parameter NAME in the union table and mapped back
// into each model's own parameter order here.

import type { GlobalFitRequest } from "../../../lib/api/globalFit";
import { boundsForWire, type ParsedFitParams } from "../../../lib/fitParams";
import type { FitModel } from "../../../lib/types";
import type { GlobalModel } from "./useGlobalFit";

type MemberSpec = NonNullable<GlobalFitRequest["dataset_models"]>[number];

/** The model one series is fitted with: its own pick (a registry model name), else the main model. */
export function modelOfMember(
  override: string | undefined,
  base: GlobalModel,
  catalog: readonly FitModel[],
): GlobalModel {
  if (!override || override === base.name) return base;
  return catalog.find((m) => m.name === override) ?? base;
}

/** Did any series pick a model other than the main one? */
export const isMultiModel = (models: readonly GlobalModel[]): boolean =>
  models.some((m) => m.name !== models[0]?.name || m.equation !== models[0]?.equation);

/** One model whose parameters are every name once (first model's defaults win). */
export function unionModel(models: readonly GlobalModel[]): GlobalModel {
  const names: string[] = [];
  const p0: number[] = [];
  const lb: (number | null)[] = [];
  const ub: (number | null)[] = [];
  for (const m of models) {
    m.paramNames.forEach((n, j) => {
      if (names.includes(n)) return;
      names.push(n);
      p0.push(m.p0[j] ?? 1);
      lb.push(m.lb[j] ?? null);
      ub.push(m.ub[j] ?? null);
    });
  }
  const labels = [...new Set(models.map((m) => m.name))];
  return { name: labels.join(" + "), paramNames: names, p0, lb, ub };
}

/** The `dataset_models` entry of one series: its model with start and bounds taken from the union table by name. */
export function memberSpec(
  m: GlobalModel,
  union: GlobalModel,
  parsed: ParsedFitParams,
  startEdited: readonly boolean[],
  anyStartEdited: boolean,
): MemberSpec {
  const at = m.paramNames.map((n) => union.paramNames.indexOf(n));
  return {
    ...(m.equation ? { equation: m.equation } : { model: m.name }),
    ...(anyStartEdited
      ? { p0: at.map((u, j) => (startEdited[u] ? parsed.p0[u]! : (m.p0[j] ?? 1))) }
      : {}),
    lower: boundsForWire(at.map((u) => parsed.lower[u]!)),
    upper: boundsForWire(at.map((u) => parsed.upper[u]!)),
  };
}
