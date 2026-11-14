// Computed error bars (origin gap audit 2 #14): an error column that comes
// from a RULE instead of an existing column — √Y (counting statistics), a
// percent of Y, or a constant — created as a LINKED formula column and bound
// as the series' symmetric Y error, as ONE undo entry and ONE recorded step.
//
// Because the result is an ordinary computed column plus an ordinary error
// role (lib/errorRoles.ts), everything that already reads roles picks it up:
// the plot's error bars (every bound window, via syncDatasetWindowDocuments),
// the curve fit's "y errors" weighting (the live `errKeys`), and export (the
// column is a worksheet column, the role is the dataset's). Editing a Y cell
// recomputes the error, because the column is a formula of it.
//
// √Y uses max(Y, 1): a zero-count (or background-subtracted negative) point
// gets σ = 1 count rather than σ = 0, which a weighted fit would treat as
// infinitely certain. Percent uses |Y| so the bar is never negative.
//
// Lazy: only the Inspector's Error columns card and pipeline replay load it.

import { baseColumns, channelLetter, referencedColumns } from "../lib/formula";
import { errKeysFromBindings, inferErrorBindings, type ErrorBinding } from "../lib/errorRoles";
import { lit } from "../lib/macro";
import { channelIndexOf } from "../lib/formulaRename";
import type { ComputedColumn, Dataset } from "../lib/types";
import { uniqueTemplateName } from "../lib/uniqueName";
import { withRecomputedFormulas } from "./computedColumns";
import { withResolved } from "./pendingEdit";
import { useApp } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";

export type ErrorSource = "sqrt" | "percent" | "constant";

export type ComputedErrorResult = { ok: true; message: string } | { ok: false; error: string };

/** The formula for `source` over column `letter` (`param` = percent or constant). */
export function errorExpr(source: ErrorSource, letter: string, param: number): string {
  if (source === "sqrt") return `sqrt(max(${letter}, 1))`;
  if (source === "percent") return `abs(${letter}) * ${param} / 100`;
  return `${param} + 0 * ${letter}`; // a constant, blank where Y is blank
}

function columnName(source: ErrorSource, label: string, param: number): string {
  if (source === "sqrt") return `√(${label})`;
  if (source === "percent") return `${param}% of ${label}`;
  return `±${param} (${label})`;
}

function checkParam(source: ErrorSource, param: number): string | null {
  if (source === "sqrt") return null;
  if (!Number.isFinite(param) || param < 0) return `the ${source === "percent" ? "percent" : "constant"} must be a non-negative number`;
  return null;
}

/** Bind channel `channel` of dataset `id` as `target`'s symmetric Y error in
 *  the state, the bound windows and (when it is on show) the live view. */
function bound(s: ReturnType<typeof useApp.getState>, id: string, next: Dataset, binding: ErrorBinding) {
  const roles = [...(next.errorRoles ?? inferErrorBindings(next.data)).filter((r) => !(r.target === binding.target && r.axis === "y")), binding];
  const withRoles = { ...next, errorRoles: roles };
  const live = s.activeId === id;
  return {
    datasets: s.datasets.map((d) => (d.id === id ? withRoles : d)),
    plotWindows: syncDatasetWindowDocuments(s.plotWindows, id, roles),
    ...(live
      ? {
          errKeys: { ...s.errKeys, ...errKeysFromBindings(roles) },
          hiddenChannels: [...new Set([...s.hiddenChannels, binding.channel])].sort((a, b) => a - b),
        }
      : {}),
  };
}

/** Add the computed error column for series `target` of dataset `id` and bind it. */
export async function addComputedError(
  id: string,
  target: number,
  source: ErrorSource,
  param = 0,
): Promise<ComputedErrorResult> {
  const get = useApp.getState;
  const bad = checkParam(source, param);
  if (bad) return { ok: false, error: bad };
  const out = await withResolved(get, id, "adding an error column", (ds): ComputedErrorResult => {
    const label = ds.data.labels[target];
    if (label === undefined || target < 0) return { ok: false, error: "pick the series the error describes" };
    const letter = channelLetter(target);
    const expr = errorExpr(source, letter, param);
    const name = uniqueTemplateName(columnName(source, label, param), new Set(ds.data.labels));
    const unit = ds.data.units[target] ?? "";
    const col: ComputedColumn = { name, expr, ...(unit ? { unit } : {}), deps: referencedColumns(expr).letters };
    get().recordHistory("add computed error");
    useApp.setState((s) => {
      const cur = s.datasets.find((d) => d.id === id)!;
      const formulas = [...(cur.formulas ?? []), col];
      const next: Dataset = { ...cur, formulas, ...withRecomputedFormulas(baseColumns(cur.data, cur.formulas?.length ?? 0), formulas) };
      const channel = next.data.labels.length - 1;
      return bound(s, id, next, { channel, target, axis: "y", side: "both" });
    });
    get().recordMacro(`Add error ${name}`, `qz.addColumn(${lit(name)}, ${lit(expr)}, { errorOf: ${lit(letter)} })`, {
      kind: "expression",
      params: { name, expr, errorOf: letter },
    });
    get().touchDataset(id);
    return { ok: true, message: `added "${name}" and bound it as ${label}'s error bars` };
  });
  const r: ComputedErrorResult = out.ok ? out.value : { ok: false, error: out.error };
  get().setStatus(r.ok ? r.message : `Can't add the error column: ${r.error}`);
  return r;
}

/** Replay of a recorded computed-error step: the column `name` was just added
 *  by the plain formula path; bind it to column `letter` as its Y error. */
export function bindReplayedError(id: string, name: string, letter: string): boolean {
  const ds = useApp.getState().datasets.find((d) => d.id === id);
  const target = channelIndexOf(letter);
  const channel = ds ? ds.data.labels.lastIndexOf(name) : -1;
  if (!ds || target === null || target >= ds.data.labels.length || channel < 0) return false;
  useApp.setState((s) => bound(s, id, ds, { channel, target, axis: "y", side: "both" }));
  return true;
}
