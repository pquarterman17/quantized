// Curve Fit — "Fit report" section (lazy chunk; mounted after a completed
// registry-model fit). Origin NLFit's report tables for THIS fit, from
// POST /api/fitting/report (calc.fit_report): per-parameter t value,
// Prob>|t| and confidence limits at a selectable level (95% default), the
// statistics block (N, df, RSS, reduced χ², R², adj. R², Root-MSE), the ANOVA
// table, and the covariance and correlation matrices.
//
// Copy puts the tables on the clipboard as TSV and Save CSV writes RFC-4180
// CSV — both through lib/statsTestsResults' serializers, whose text cells are
// formula-neutralized (OWASP), from the SAME tables the panel shows.

import { useEffect, useMemo, useState } from "react";

import { fitReport, type FitReportResult } from "../../../lib/api/fitReport";
import { copyText } from "../../../lib/clipboard";
import { csvBlob } from "../../../lib/csvCell";
import { saveBlob } from "../../../lib/download";
import { fmtNum } from "../../../lib/format";
import { tablesToCSV, tablesToTSV, type ResultTable } from "../../../lib/statsTestsResults";
import type { CalcResult } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { parameterTable, pctLabel, REPORT_LEVELS, reportTables } from "./fitReportTables";
import { reportPrefs, type FittedData } from "./curveFitSession";

interface Props {
  result: CalcResult;
  fitData: FittedData;
  paramNames: readonly string[];
  /** The CSV file name's stem (dataset name without extension + model). */
  fileStem: string;
}

const cellText = (v: string | number | null): string => (typeof v === "number" ? fmtNum(v) : v ?? "—");

function TableView({ table }: { table: ResultTable }) {
  return (
    <div className="qzk-dense-table" style={{ marginTop: 8, overflowX: "auto" }}>
      <div className="qzk-field-lbl">{table.title}</div>
      <DataTable columns={table.columns} rows={table.rows.map((row) => row.map(cellText))} />
    </div>
  );
}

export default function FitReportSection({ result, fitData, paramNames, fileStem }: Props) {
  const [open, setOpen] = useState(false);
  const [level, setLevelState] = useState(reportPrefs.level);
  const setLevel = (v: number) => setLevelState((reportPrefs.level = v));
  const [rep, setRep] = useState<FitReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const weighted = fitData.dy != null;

  useEffect(() => {
    setRep(null);
    setError(null);
    const residuals = result.residuals as (number | null)[] | undefined;
    if (!open || !Array.isArray(residuals)) return;
    const params = (result.params as number[] | undefined) ?? [];
    const ctrl = new AbortController();
    fitReport(
      {
        params,
        errors: ((result.errors as (number | null)[] | undefined) ?? params.map(() => null)),
        covar: (result.covar as number[][] | null | undefined) ?? null,
        y: fitData.y,
        residuals: residuals.map((v) => v ?? Number.NaN),
        n_free: Number(result.nFree ?? params.length),
        dy: fitData.dy ?? null,
        level,
      },
      ctrl.signal,
    )
      .then(setRep)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "fit report failed");
      });
    return () => ctrl.abort();
  }, [open, level, result, fitData]);

  const tables = useMemo(() => (rep ? reportTables(paramNames, rep, weighted) : []), [rep, paramNames, weighted]);
  const status = useApp((s) => s.setStatus);

  const copy = async (which: "params" | "all") => {
    if (!rep) return;
    const text = tablesToTSV(which === "params" ? [parameterTable(paramNames, rep)] : tables);
    status((await copyText(text)) ? `copied the fit ${which === "params" ? "parameters" : "report"}` : "clipboard unavailable — use Save CSV instead");
  };
  const save = () => {
    if (!rep) return;
    const stem = fileStem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "fit";
    saveBlob(csvBlob(tablesToCSV(tables)), `${stem}-fit-report.csv`);
    status("saved the fit report");
  };

  return (
    <details
      style={{ marginTop: 10 }}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="qzk-field-lbl">Fit report</summary>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <span className="qzk-ds-meta">Confidence</span>
        <Select
          aria-label="Parameter confidence level"
          options={REPORT_LEVELS.map((l) => ({ value: String(l), label: pctLabel(l) }))}
          value={String(level)}
          onChange={(e) => setLevel(Number(e.target.value))}
        />
        <Button size="sm" disabled={!rep} onClick={() => void copy("params")} title="Copy the parameter table as tab-separated text">
          Copy parameters
        </Button>
        <Button size="sm" disabled={!rep} onClick={() => void copy("all")} title="Copy every report table as tab-separated text">
          Copy report
        </Button>
        <Button size="sm" disabled={!rep} onClick={save} title="Save every report table as a CSV file">
          Save report CSV
        </Button>
      </div>
      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {open && !rep && !error && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          computing report…
        </div>
      )}
      {tables.map((t) => (
        <TableView key={t.title} table={t} />
      ))}
    </details>
  );
}
