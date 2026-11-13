// A fit template run as a pipeline / batch step (integration review item 4).
// The step used to replay as a bare {model} fit — unweighted, from the
// registry's static starts, ignoring the template's start/bounds/hold table,
// weighting and X range — so a template applied in Pipeline Studio fitted
// differently from the same template applied in the Curve Fit panel.
//
// Here the template's own settings drive the request on the TARGET worksheet:
//   - channels: X = the time/X axis, Y = the first channel that is not an
//     error column (the error-role defaults the plot uses);
//   - X range: rows outside the template's range are left out;
//   - weighting: Y error column = the target's error column for that Y,
//     Poisson as is, manual / direct = the column with the template's LABEL;
//     a column the target lacks fits unweighted and says so;
//   - starts: a typed start as typed, a blank one from the data-driven guess
//     (the panel's rule, lib/fitParams autoStartRows), clipped into the
//     bounds; bounds and holds as recorded.

import { autoGuess } from "./api/curvefit";
import { dropGapRows } from "./api/finitePairs";
import { errorRoleViewDefaults } from "./errorbars";
import { boundsForWire } from "./fitBoundsWire";
import type { FitTemplateSettings } from "./fitTemplates";
import { dyForFit, weightRequestFields } from "./fitweights";
import { analysisData } from "./rowstate";
import type { Dataset, FitWeighting } from "./types";

export interface TemplateFitRequest {
  request: {
    model: string; x: number[]; y: number[];
    dy?: number[]; weights?: number[]; scale_errors?: false;
    p0?: number[]; lower?: (number | null)[]; upper?: (number | null)[]; fixed?: boolean[];
  };
  /** Said in the step log: unweighted fallbacks and left-out rows. */
  notes: string[];
}

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export async function templateFitRequest(
  ds: Dataset,
  t: FitTemplateSettings,
  guess: typeof autoGuess = autoGuess,
): Promise<TemplateFitRequest> {
  const d = analysisData(ds);
  if (!d || d.values.length === 0) throw new Error("no data to fit");
  const roles = errorRoleViewDefaults({ ...ds, data: d });
  const hidden = new Set(roles.hiddenChannels);
  const yKey = d.labels.findIndex((_, k) => !hidden.has(k));
  if (yKey < 0) throw new Error("no response column is available to fit");
  const notes: string[] = [];
  const inRange = d.time.map((x) => !t.range || (x >= t.range.lo && x <= t.range.hi));
  const rows = d.time.flatMap((_, i) => (inRange[i] ? [i] : []));
  const pairs = dropGapRows(rows.map((i) => d.time[i]!), rows.map((i) => d.values[i]![yKey]!));
  if (pairs.x.length === 0) throw new Error("no finite X/Y pairs are available to fit");
  const keep = pairs.keep.map((k) => rows[k]!);

  let weight: FitWeighting | null = null;
  const scale = t.scaleErrors === false ? { scaleErrors: false as const } : {};
  if (t.weight === "poisson") weight = { mode: "poisson", ...scale };
  else if (t.weight === "yerr") {
    const errKey = roles.errKeys[yKey];
    if (errKey === undefined) notes.push("no error column for the Y channel — fitting unweighted");
    else weight = { mode: "yerr", errKey, ...scale };
  } else if (t.weight === "manual" || t.weight === "direct") {
    const errKey = t.manualLabel === undefined ? -1 : d.labels.indexOf(t.manualLabel);
    if (errKey < 0) notes.push(`no column "${t.manualLabel ?? ""}" — fitting unweighted`);
    else weight = { mode: t.weight, errKey, ...scale };
  }
  let vec: number[] | null = null;
  if (weight) {
    const res = dyForFit(ds, yKey, weight, keep);
    if (res.dy) vec = keep.map((i) => res.dy![i]!);
    else notes.push(`${res.issue ?? "weight column unusable"} — fitting unweighted`);
  }

  const request: TemplateFitRequest["request"] = {
    model: t.model, x: pairs.x, y: pairs.y, ...(vec && weight ? weightRequestFields(weight, vec) : {}),
  };
  const edited = t.rows.some((r) => r.start.trim() !== "" || r.min.trim() !== "" || r.max.trim() !== "" || r.fixed);
  if (edited) {
    const lower = t.rows.map((r) => num(r.min) ?? -Infinity);
    const upper = t.rows.map((r) => num(r.max) ?? Infinity);
    const bad = t.rows.find((_, i) => Number.isNaN(lower[i]) || Number.isNaN(upper[i]));
    if (bad) throw new Error(`${bad.name}: a bound is not a number`);
    const blank = t.rows.some((r) => num(r.start) === null);
    const g = blank ? (await guess(t.model, pairs.x, pairs.y)).p0 : [];
    request.p0 = t.rows.map((r, i) => {
      const typed = num(r.start);
      if (typed !== null && !Number.isFinite(typed)) throw new Error(`${r.name}: start is not a number`);
      if (typed !== null) return typed;
      if (r.fixed) throw new Error(`${r.name}: a held parameter needs a start`);
      const v = Number.isFinite(g[i]) ? g[i]! : 1;
      return Math.min(Math.max(v, lower[i]!), upper[i]!);
    });
    request.lower = boundsForWire(lower);
    request.upper = boundsForWire(upper);
    if (t.rows.some((r) => r.fixed)) request.fixed = t.rows.map((r) => r.fixed);
  }
  if (pairs.n !== pairs.keep.length) notes.push(`${pairs.n - pairs.keep.length} gap rows excluded`);
  return { request, notes };
}
