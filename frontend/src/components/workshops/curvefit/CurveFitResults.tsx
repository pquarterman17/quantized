// Curve Fit — the registry-model RESULT area, split out of CurveFitPanel.tsx
// (component ceiling). Key results first, above the fold: the parameter table
// (value ± error) and the headline statistics (N, R², reduced χ², RMSE, AIC),
// with the result actions (→ Report, corner plot, Remove fit). Below them the
// residual plots (first under the results, UX-F) and then the deeper
// tools, each its own lazy chunk fetched only when a fit exists: Find X/Y,
// bands, the NLFit-style fit report, output to worksheet and diagnostics.

import { DataTable } from "../../primitives/DataTable";
import { Button } from "../../primitives";
import { stemFromName } from "../../../lib/exportActive";
import { copyText } from "../../../lib/clipboard";
import { fitResultMarkdown, fitResultTsv, fitResultView, type FitResultInput } from "../../../lib/fitResultView";
import { sigFigs } from "../../../lib/fitValueFormat";
import { fmtNum as fmt } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import { lazyRegion } from "../../../lib/lazyRegion";
import type { CalcResult, Dataset } from "../../../lib/types";
import { singleFitTable } from "../../../lib/fitTableLayer";
import FindXYSection from "./FindXYSection";
import FitTableControls from "./FitTableControls";
import type { FittedData } from "../../../store/curveFitSession";

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
  /** The fit's input data changed after this fit ran (and no re-fit has landed). */
  stale: boolean;
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

/** The result's inputs for the table builders: the fitted X/Y column units come
 *  from the dataset's own (never guessed; blank when it has none). */
function resultInput(ds: Dataset, model: string, names: readonly string[], result: CalcResult, fit: FittedData | null): FitResultInput {
  const d = ds.data;
  const meta = d.metadata ?? {};
  const xKey = fit?.xKey ?? null;
  const yKey = fit?.yKey;
  return {
    model,
    names,
    result,
    fixed: fit?.fixed,
    xUnit: xKey == null ? String(meta["x_column_unit"] ?? "") : (d.units[xKey] ?? ""),
    yUnit: yKey == null ? "" : (d.units[yKey] ?? ""),
  };
}

export default function CurveFitResults(p: Props) {
  const { active, result, fitData, guessOnly, modelName } = p;
  const params = (result?.params as number[] | undefined) ?? [];
  const names = params.map((_, i) => p.paramNames[i] ?? `p${i}`);
  const done = result && !guessOnly;

  const setStatus = useApp((s) => s.setStatus);
  const view = done && active ? fitResultView(resultInput(active, modelName, names, result, fitData)) : null;
  const copy = async (md: boolean) => {
    if (!active || !result) return;
    const input = resultInput(active, modelName, names, result, fitData);
    const ok = await copyText(md ? fitResultMarkdown(input) : fitResultTsv(input));
    setStatus(ok ? `copied the fit results (${md ? "Markdown" : "TSV, paste into Excel"})` : "clipboard unavailable");
  };

  // Review #8: a saved fit drawn after a reopen (its curve restored from the
  // figure or its saved parameters) has no in-memory result here -- Remove fit
  // must still be reachable without fitting again.
  const saved = !result && active?.fitSpec?.params?.length ? active.fitSpec : null;

  return (
    <>
      {saved && (
        <div className="qzk-ds-meta" role="status" style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span>Saved {saved.model} fit. Press Fit to see its statistics again.</span>
          <Button size="sm" variant="ghost" title="Delete this fit's saved recipe and Library result, and its curve in this window (other figures keep their saved copy; Undo restores)" onClick={p.onRemoveFit}>
            Remove fit
          </Button>
        </div>
      )}
      {saved && (
        // The saved parameters, as recorded (gap audit 6 lane K acceptance 1);
        // names only when the picker is on the saved model.
        <div style={{ marginTop: 8 }}>
          <DataTable
            columns={["param", "value", "± err"]}
            rows={saved.params!.map((v, i) => [
              (modelName === saved.model ? p.paramNames[i] : undefined) ?? `p${i}`,
              fmt(v),
              fmt(saved.errors?.[i] ?? null),
            ])}
          />
        </div>
      )}
      {done && p.stale && (
        <div className="qzk-helptext" role="status" style={{ marginTop: 10, color: "var(--warn)" }}>
          The data or weighting selected for fitting changed after this fit, so the results below describe the earlier inputs. Press Fit to update them.
        </div>
      )}
      {view && view.paramRows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <DataTable columns={view.paramColumns} rows={view.paramRows} />
        </div>
      )}
      {view?.notes.map((n) => (
        <div key={n} className="qzk-ds-meta" role="status" style={{ marginTop: 6, color: "var(--warn)" }}>{n}</div>
      ))}
      {view && (
        <div style={{ marginTop: 8 }}>
          <DataTable columns={["stat", "value"]} rows={view.statRows} />
        </div>
      )}
      {!done && params.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <DataTable columns={["param", "value", "± err"]} rows={params.map((v, i) => [names[i]!, sigFigs(v, 6), "—"])} />
        </div>
      )}
      {done && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="sm" title="Copy the results table as tab-separated text (pastes into Excel)" onClick={() => void copy(false)}>
            Copy
          </Button>
          <Button size="sm" title="Copy the results table as Markdown" onClick={() => void copy(true)}>
            Copy MD
          </Button>
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
            title="Delete this fit, its saved recipe and Library result, and its curve in this window (other figures keep their saved copy; closing the window keeps them; Undo restores)"
            onClick={p.onRemoveFit}
          >
            Remove fit
          </Button>
        </div>
      )}

      {/* The residuals come straight after the parameters: the most important
          result after them (UX-F). */}
      {done && active && fitData && (
        <ResidualPlotsSection result={result} fitData={fitData} xLabel={xLabelOf(active, fitData.xKey)} />
      )}

      {/* Find X from Y / Y from X (MAIN #15) — inverse-evaluate the fit. */}
      {done && p.xRange && (
        <FindXYSection target={{ model: modelName, params, xMin: p.xRange.min, xMax: p.xRange.max }} />
      )}

      {done && active && fitData && (
        <>
          <FitBandsSection target={{ dataset: active, model: modelName, result, fitData }} />
          <FitReportSection result={result} fitData={fitData} paramNames={names} fileStem={`${stemFromName(active.name)}-${modelName}`} />
          <FitOutputSection dataset={active} model={modelName} paramNames={names} result={result} fitData={fitData} />
          <FitTableControls sourceKey={`single:${active.id}`} stats={["r2", "chiSqRed", "chiSq", "n"]} build={(want) => singleFitTable(names, result, want, fitData.fixed)} />
          <FitDiagnosticsSection result={result} fitData={fitData} />
        </>
      )}
    </>
  );
}
