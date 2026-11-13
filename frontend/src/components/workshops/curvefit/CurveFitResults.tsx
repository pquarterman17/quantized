// Curve Fit — the registry-model RESULT area, split out of CurveFitPanel.tsx
// (component ceiling). Key results first, above the fold: the parameter table
// (value ± error) and the headline statistics (N, R², reduced χ², RMSE, AIC),
// with the result actions (→ Report, corner plot, Remove fit). Below them the
// deeper tools, each its own lazy chunk fetched only when a fit exists:
// Find X/Y, bands, the NLFit-style fit report, residual plots, output to
// worksheet and diagnostics.

import { DataTable } from "../../primitives/DataTable";
import { Button } from "../../primitives";
import { stemFromName } from "../../../lib/exportActive";
import { fmtNum as fmt } from "../../../lib/format";
import { lazyRegion } from "../../../lib/lazyRegion";
import type { CalcResult, Dataset } from "../../../lib/types";
import FindXYSection from "./FindXYSection";
import type { FittedData } from "./curveFitSession";

const FitBandsSection = lazyRegion(() => import("./FitBandsSection"), "Bands");
const FitDiagnosticsSection = lazyRegion(() => import("./FitDiagnosticsSection"), "Diagnostics");
const FitReportSection = lazyRegion(() => import("./FitReportSection"), "Fit report");
const ResidualPlotsSection = lazyRegion(() => import("./ResidualPlotsSection"), "Residual plots");
const FitOutputSection = lazyRegion(() => import("./FitOutputSection"), "Output to worksheet");

interface Props {
  active: Dataset | null;
  modelName: string;
  paramNames: readonly string[];
  result: CalcResult | null;
  fitData: FittedData | null;
  guessOnly: boolean;
  xRange: { min: number; max: number } | null;
  reporting: boolean;
  onReport: () => void;
  cornerBusy: boolean;
  onCornerPlot: () => void;
  onRemoveFit: () => void;
}

/** The fitted X column's display name, for the residual-vs-X axis. */
function xLabelOf(ds: Dataset, xKey: number | null): string {
  if (xKey != null) return ds.data.labels[xKey] ?? "x";
  const meta = ds.data.metadata ?? {};
  return String(meta["x_column_long"] || meta["x_column_name"] || "x");
}

export default function CurveFitResults(p: Props) {
  const { active, result, fitData, guessOnly, modelName } = p;
  const params = (result?.params as number[] | undefined) ?? [];
  const errors = (result?.errors as (number | null)[] | undefined) ?? [];
  const names = params.map((_, i) => p.paramNames[i] ?? `p${i}`);
  const done = result && !guessOnly;

  const paramRows = params.map((v, i) => [names[i]!, fmt(v), guessOnly ? "—" : fmt(errors[i])]);
  const statRows: string[][] = done
    ? [
        ["N", fmt(result.nPoints)],
        ["R²", fmt(result.R2)],
        ["reduced χ²", fmt(result.chiSqRed)],
        ["RMSE", fmt(result.RMSE)],
        ["AIC", fmt(result.AIC)],
      ]
    : [];

  return (
    <>
      {paramRows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <DataTable columns={["param", "value", "± err"]} rows={paramRows} />
        </div>
      )}
      {statRows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <DataTable columns={["stat", "value"]} rows={statRows} />
        </div>
      )}
      {done && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="sm" disabled={p.reporting} onClick={p.onReport}>
            {p.reporting ? "Reporting…" : "→ Report"}
          </Button>
          <Button
            size="sm"
            disabled={p.cornerBusy}
            title="Bootstrap the fit and export a pairwise parameter-uncertainty corner plot"
            onClick={p.onCornerPlot}
          >
            {p.cornerBusy ? "Bootstrapping…" : "Corner plot…"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Delete this fit, its curve, saved recipe and Library result (closing the window keeps them; Undo restores)"
            onClick={p.onRemoveFit}
          >
            Remove fit
          </Button>
        </div>
      )}

      {/* Find X from Y / Y from X (MAIN #15) — inverse-evaluate the fit. */}
      {done && p.xRange && (
        <FindXYSection target={{ model: modelName, params, xMin: p.xRange.min, xMax: p.xRange.max }} />
      )}

      {done && active && fitData && (
        <>
          <FitBandsSection target={{ dataset: active, model: modelName, result, fitData }} />
          <FitReportSection result={result} fitData={fitData} paramNames={names} fileStem={`${stemFromName(active.name)}-${modelName}`} />
          <ResidualPlotsSection result={result} fitData={fitData} xLabel={xLabelOf(active, fitData.xKey)} />
          <FitOutputSection dataset={active} model={modelName} paramNames={names} result={result} fitData={fitData} />
          <FitDiagnosticsSection result={result} fitData={fitData} />
        </>
      )}
    </>
  );
}
