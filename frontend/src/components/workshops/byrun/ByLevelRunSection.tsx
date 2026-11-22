// The shared "By" block for single-curve tools: an optional categorical-column
// select and one summary row per level (see ./useByLevelRun). Renders nothing
// when the worksheet has no categorical column to group by.

import { useMemo } from "react";

import { fmtNum } from "../../../lib/format";
import type { Dataset, DataStruct } from "../../../lib/types";
import { DataTable } from "../../primitives/DataTable";
import { Select } from "../../primitives";
import type { ByColumnOption } from "../useByPartition";
import { type ByCell, useByLevelRun } from "./useByLevelRun";
import type { ByLevel } from "../useByPartition";

interface Props {
  /** Tool name for the accessible label ("Find peaks"). */
  tool: string;
  active: Dataset | null;
  /** The analysis view of `active` (never the raw data). */
  data: DataStruct | null;
  /** Columns that may group the run (the caller drops the X and Y it uses). */
  columns: readonly ByColumnOption[];
  /** Header of each summary cell, after "Level" and "n". */
  headers: readonly string[];
  run: (level: ByLevel, signal: AbortSignal) => Promise<ByCell[]>;
  /** Changes whenever a setting the per-level result depends on changes. */
  runKey: string;
  /** Why By cannot run right now (shown instead of results once a column is picked). */
  blockedReason?: string | null;
}

const cell = (v: ByCell): string => (typeof v === "number" ? fmtNum(v) : v ?? "—");

export default function ByLevelRunSection({ tool, active, data, columns, headers, run, runKey, blockedReason }: Props) {
  const guarded = useMemo(
    () => async (level: ByLevel, signal: AbortSignal): Promise<ByCell[]> => {
      if (blockedReason) throw new Error(blockedReason);
      return run(level, signal);
    },
    [run, blockedReason],
  );
  const by = useByLevelRun(active, data, columns, guarded, `${runKey}|${blockedReason ?? ""}`);
  if (by.byOptions.length === 0) return null;
  return (
    <section aria-label={`${tool} by level`} style={{ marginTop: 10 }}>
      <label className="qzk-field-lbl">By (optional)</label>
      <Select
        aria-label={`${tool} By (optional)`}
        options={[{ value: "", label: "None" }, ...by.byOptions.map((c) => ({ value: String(c.index), label: c.label }))]}
        value={by.byCol == null ? "" : String(by.byCol)}
        onChange={(e) => by.setByCol(e.target.value === "" ? null : Number(e.target.value))}
      />
      {by.byCol != null && (
        <div style={{ marginTop: 6, overflowX: "auto" }}>
          {by.totalLevels > by.levels.length && (
            <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
              By column has {by.totalLevels} levels — showing the first {by.levels.length}
            </div>
          )}
          {by.busy && by.rows.length === 0 ? (
            <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>running {by.levels.length} levels…</div>
          ) : (
            <DataTable
              columns={["Level", "n", ...headers]}
              rows={by.rows.map((r) => r.error
                ? [r.label, r.n, <span key="e" style={{ color: "var(--text-faint)" }}>{r.error}</span>, ...headers.slice(1).map(() => "")]
                : [r.label, r.n, ...r.values.map(cell)])}
            />
          )}
        </div>
      )}
    </section>
  );
}
