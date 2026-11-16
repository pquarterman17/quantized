// Surface-fit result as text (pure): the parameter table and the headline
// statistics as TSV (pastes into Excel) or a Markdown table, mirroring what
// Curve Fit's "copy results" gives. A held parameter reads "fixed".

import type { SurfaceFitResult } from "../../../lib/api/analysisExtras";

const num = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? "" : String(Number(v.toPrecision(8))));

export function surfaceResultText(r: SurfaceFitResult, markdown: boolean): string {
  const pct = `${Math.round(r.level * 100)}%`;
  const head = ["parameter", "value", "SE", `${pct} low`, `${pct} high`];
  const rows = r.param_names.map((name, i) => [
    name,
    num(r.params[i]),
    r.fixed[i] ? "fixed" : num(r.inference[i]?.error),
    num(r.inference[i]?.lcl),
    num(r.inference[i]?.ucl),
  ]);
  const stats = [
    ["model", r.model_name],
    ["N points", String(r.n_points)],
    ["degrees of freedom", String(r.dof)],
    ["R^2", num(r.r2)],
    ["RMSE", num(r.rmse)],
    ["reduced chi^2", num(r.chi_sq_red)],
  ];
  if (!markdown) return [head, ...rows, [], ...stats].map((row) => row.join("\t")).join("\n");
  const md = (row: string[]): string => `| ${row.join(" | ")} |`;
  return [
    md(head),
    md(head.map(() => "---")),
    ...rows.map(md),
    "",
    md(["stat", "value"]),
    md(["---", "---"]),
    ...stats.map(md),
  ].join("\n");
}
