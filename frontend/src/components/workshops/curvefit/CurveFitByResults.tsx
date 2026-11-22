// Curve Fit results while a By column is picked: one collapsible section per
// level (CurveFitByLevelSection), the level-cap note, and an opt-in "Save By
// result" that records the SAME per-level fits as one analysis-batch result,
// one row per level: its parameters with their errors, R² and RMSE. Curve fit
// keeps its own By runner (a parameter table per level, the panel's weighting
// and start values) and shares only the Save option with the byrun tools.

import { useMemo } from "react";

import type { Dataset } from "../../../lib/types";
import type { ByLevelRow } from "../byrun/useByLevelRun";
import { useSaveByResult } from "../byrun/useSaveByResult";
import { Button } from "../../primitives";
import CurveFitByLevelSection from "./CurveFitByLevelSection";
import type { CurveFitByLevelState, CurveFitLevelResult } from "./useCurveFitByLevel";

/** The table the saved result carries: headers, then one row per level. */
export function curveFitByTable(results: readonly CurveFitLevelResult[], paramNames: readonly string[]): { headers: string[]; rows: ByLevelRow[] } {
  const count = Math.max(paramNames.length, ...results.map((r) => (r.result?.params as unknown[] | undefined)?.length ?? 0));
  const names = Array.from({ length: count }, (_, i) => paramNames[i] ?? `p${i}`);
  const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    headers: [...names.flatMap((name) => [name, `${name} ± err`]), "R²", "RMSE"],
    rows: results.map((r) => {
      const params = (r.result?.params as unknown[] | undefined) ?? [];
      const errors = (r.result?.errors as unknown[] | undefined) ?? [];
      return {
        label: r.label, n: r.n, error: r.error,
        values: r.error || !r.result ? [] : [
          ...names.flatMap((_name, i) => [finite(params[i]), finite(errors[i])]),
          finite(r.result.R2), finite(r.result.RMSE),
        ],
      };
    }),
  };
}

export default function CurveFitByResults({ active, by, paramNames }: { active: Dataset | null; by: CurveFitByLevelState; paramNames: string[] }) {
  // Keyed on the names' CONTENT: the panel hands over a fresh [] for a model it
  // cannot resolve, and a new rows identity would defeat "already saved".
  const namesKey = paramNames.join("\u0000");
  const table = useMemo(() => curveFitByTable(by.results, namesKey ? namesKey.split("\u0000") : []), [by.results, namesKey]);
  const saver = useSaveByResult("Curve fit", active, table.headers, { ...by, rows: table.rows }, {
    toolId: "curvefit", ...by.provenance,
  });
  return (
    <>
      {by.totalLevels > by.levels.length && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          By column has {by.totalLevels} levels — showing the first {by.levels.length}
        </div>
      )}
      {by.busy && by.results.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          fitting {by.levels.length} levels…
        </div>
      ) : (
        by.results.map((r) => <CurveFitByLevelSection key={r.label} result={r} paramNames={paramNames} />)
      )}
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <Button size="sm" disabled={saver.disabledReason !== null} onClick={saver.save}
          title={saver.disabledReason ?? "One result with a row per level, in the Library and the Result book"}>
          Save By result
        </Button>
        {saver.disabledReason && <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>{saver.disabledReason}</span>}
      </div>
    </>
  );
}
