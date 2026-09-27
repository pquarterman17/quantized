// P2.5 derived expressions — what a new computed column IS, before anything is
// committed: the worksheet ƒx bar (and a replayed recipe step) hands this an
// expression, and it returns the column(s) to add or a refusal saying why.
//
//   1. The expression must compile (lib/formula.ts; Python-like syntax,
//      positioned errors) and read only columns that exist.
//   2. Its fitted-value references resolve against the dataset's OWN saved
//      fit into a snapshot on the column (lib/formulaFitRefs.ts); a missing,
//      different or non-converged fit, or an unknown parameter, refuses.
//   3. Its unit is derived from the operand units (lib/derivedUnits.ts); a
//      dimensional contradiction refuses, every assumption is a note.
//   4. With `propagate`, a second column holds its first-order, uncorrelated
//      σ (lib/derivedPropagate.ts) over the inputs' bound symmetric error
//      columns (the P1.6 error roles); the caller binds it to the first.
//
// Pure: a Dataset in, columns out. The store action that commits them
// (store/derivedColumnRun.commitDerivedColumns) owns undo, the error binding and
// the recorded step.

import { columnsRead, parseExpr } from "./derivedExprAst";
import { PropagationError, propagateSigma, type SigmaInput } from "./derivedPropagate";
import { deriveUnit } from "./derivedUnits";
import { inferErrorBindings } from "./errorRoles";
import { channelLetter, compileFormula, referencedColumns } from "./formula";
import { resolveFits } from "./derivedFitRefs";
import { channelIndexOf } from "./formulaRename";
import type { DerivedSpec } from "./formulaTypes";
import type { ComputedColumn, Dataset } from "./types";
import { uniqueTemplateName } from "./uniqueName";

export interface DeriveRequest {
  name: string;
  expr: string;
  /** Also derive the propagated-uncertainty column. */
  propagate: boolean;
  /** Add the column even though its operands' units contradict each other —
   *  with NO unit and the contradiction kept as a note. The user asked twice
   *  (store/derivedColumnRun.ts), or a recorded step said so. */
  allowUnitMismatch?: boolean;
}

export type DeriveOutcome =
  | {
      ok: true;
      /** [value] or [value, σ] — append in this order. */
      columns: ComputedColumn[];
      /** Bind columns[1] as the symmetric error of columns[0]. */
      bindSigma: boolean;
      unit: string;
      dimensionless: boolean;
      notes: string[];
      /** The units contradicted each other and the column was added anyway. */
      unitMismatchAllowed: boolean;
    }
  | { ok: false; error: string; unitMismatch?: true };

export const SIGMA_METHOD = "first-order, uncorrelated" as const;

/** A dataset's recorded x unit ("" when unknown) — the same 3-key fallback as
 *  lib/transformResample.ts's `xUnitOf`, duplicated (not imported) like
 *  lib/recipeExpect.ts's copy, so this lazy chunk does not pull that
 *  workshop's API import chain across the eager boundary. */
function xUnitOf(ds: Dataset): string {
  for (const key of ["xUnit", "x_column_unit", "xColumnUnit"]) {
    const raw = ds.data.metadata?.[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

/** The evaluator's (authoritative) parse error, with the column the tree
 *  parser — same grammar — stopped at: "unknown function \"sqr\" (column 3)". */
function positioned(expr: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : "formula error";
  if (/\(column \d+\)$/.test(msg)) return msg;
  try {
    parseExpr(expr);
  } catch (pe) {
    const col = pe instanceof Error ? /\(column \d+\)$/.exec(pe.message) : null;
    if (col) return `${msg} ${col[0]}`;
  }
  return msg;
}

/** Every column `letter` is computed from, itself included (formula deps). */
function upstreamOf(ds: Dataset, letter: string): Set<string> {
  const formulas = ds.formulas ?? [];
  const baseCount = ds.data.labels.length - formulas.length;
  const out = new Set<string>();
  const stack = [letter];
  while (stack.length) {
    const l = stack.pop()!;
    if (out.has(l)) continue;
    out.add(l);
    const idx = channelIndexOf(l);
    const f = idx !== null && idx >= baseCount ? formulas[idx - baseCount] : undefined;
    if (f) stack.push(...(f.deps ?? referencedColumns(f.expr).letters));
  }
  return out;
}

export function deriveColumns(ds: Dataset, req: DeriveRequest): DeriveOutcome {
  const expr = req.expr.trim();
  const name = req.name.trim() || expr;
  try {
    compileFormula(expr);
  } catch (e) {
    return { ok: false, error: positioned(expr, e) };
  }
  const root = parseExpr(expr);
  const { labels, units } = ds.data;
  const read = [...columnsRead(root)];
  for (const l of read) {
    const idx = channelIndexOf(l);
    if (l !== "x" && (idx === null || idx >= labels.length)) return { ok: false, error: `there is no column ${l}` };
  }
  const index = (l: string): number => (l === "x" ? -1 : channelIndexOf(l)!);
  const label = (l: string): string => {
    const text = l === "x" ? "" : labels[index(l)];
    return text && text !== l ? `${l} (${text})` : l;
  };

  const resolved = resolveFits(ds, root);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { fits } = resolved;

  const unitResult = deriveUnit(root, {
    unitOf: (l) => (l === "x" ? xUnitOf(ds) : (units[index(l)] ?? "")),
    label,
    fitYUnit: (model) => {
      const y = ds.fitSpec?.model === model ? ds.fitSpec.yKey : undefined;
      return typeof y === "number" ? (units[y] ?? "") : "";
    },
  });
  if (unitResult.error && !req.allowUnitMismatch) return { ok: false, error: unitResult.error, unitMismatch: true };
  const { unit } = unitResult;
  const notes = [...unitResult.warnings, ...(unitResult.error ? [`${unitResult.error}; added WITHOUT a unit, as asked`] : [])];
  const spec = (extra: DerivedSpec, colNotes: string[]): DerivedSpec | undefined => {
    const out: DerivedSpec = { ...(unit ? { unitAuto: true } : {}), ...(colNotes.length ? { notes: colNotes } : {}), ...extra };
    return Object.keys(out).length ? out : undefined;
  };
  const withSpec = (c: ComputedColumn, d: DerivedSpec | undefined): ComputedColumn => (d ? { ...c, derived: d } : c);
  const value = withSpec({ name, expr, ...(unit ? { unit } : {}) }, spec(fits.length ? { fits } : {}, notes));
  const done = (columns: ComputedColumn[], extra: string[] = []): DeriveOutcome => ({
    ok: true,
    columns,
    bindSigma: columns.length > 1,
    unit,
    dimensionless: unitResult.dimensionless,
    notes: [...notes, ...extra],
    unitMismatchAllowed: !!unitResult.error,
  });
  if (!req.propagate) return done([value]);

  if ((ds.formulas ?? []).some((f) => f.name === name))
    return { ok: false, error: `a computed column named "${name}" already exists; name this one differently (its uncertainty links to it by name)` };
  const roles = ds.errorRoles ?? inferErrorBindings(ds.data);
  const inputs: SigmaInput[] = [];
  const exact: string[] = [];
  for (const l of read) {
    const target = index(l);
    const sym = [...new Set(roles.filter((b) => b.target === target && b.side === "both").map((b) => b.channel))];
    if (sym.length > 1) return { ok: false, error: `${label(l)} has more than one bound error column; keep one before propagating` };
    if (!sym.length && roles.some((b) => b.target === target))
      return { ok: false, error: `${label(l)} has an asymmetric (+/−) error pair; first-order propagation needs one symmetric error column` };
    if (sym.length) inputs.push({ name: l, sigma: channelLetter(sym[0]) });
    else exact.push(label(l));
  }
  if (!inputs.length)
    return { ok: false, error: `none of the columns this formula reads (${read.map(label).join(", ")}) has a bound error column to propagate` };
  let sigma: { expr: string; used: SigmaInput[] };
  try {
    sigma = propagateSigma(root, inputs, (m) => fits.find((f) => f.model === m)?.expr);
    compileFormula(sigma.expr);
  } catch (e) {
    if (e instanceof PropagationError) return { ok: false, error: e.message };
    throw e;
  }
  const sNotes = [`σ by ${SIGMA_METHOD} propagation from ${sigma.used.map((u) => `${label(u.name)} ± ${u.sigma}`).join(", ")}`];
  if (exact.length) sNotes.push(`treated as exact (no bound error column): ${exact.join(", ")}`);
  if (fits.length) sNotes.push("fitted parameters are treated as exact (their standard errors are not stored with the fit)");
  for (let i = 0; i < sigma.used.length; i++) {
    for (let j = i + 1; j < sigma.used.length; j++) {
      const a = upstreamOf(ds, sigma.used[i].name);
      const shared = [...upstreamOf(ds, sigma.used[j].name)].filter((l) => a.has(l));
      if (shared.length)
        sNotes.push(`${label(sigma.used[i].name)} and ${label(sigma.used[j].name)} share ${shared.join(", ")}, so they are correlated; this σ ignores that`);
    }
  }
  const sigmaCol = withSpec(
    { name: uniqueTemplateName(`σ(${name})`, new Set([...labels, name])), expr: sigma.expr, ...(unit ? { unit } : {}) },
    spec(
      {
        sigmaOf: { name, method: SIGMA_METHOD },
        ...(/\bfit(val)?\s*\(/.test(sigma.expr) ? { fits } : {}),
      },
      sNotes,
    ),
  );
  // The link is held on both ends (DerivedSpec.sigma / sigmaOf).
  return done([{ ...value, derived: { ...value.derived, sigma: sigmaCol.name } }, sigmaCol], sNotes);
}
