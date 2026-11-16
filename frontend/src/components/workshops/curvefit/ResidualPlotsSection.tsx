// Curve Fit — "Residual plots" section (lazy chunk; mounted after a completed
// registry-model fit; opens with Curve Fit's Results tab). Residual vs X, residual vs
// fitted value, a histogram and a normal Q-Q plot of THIS fit's residuals,
// drawn by the shared SmallUPlot. The Q-Q pairs are calc.fit_stats'
// residual_diagnostics (POST /api/fitting/diagnostics), fetched only when the
// section is open and in view.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { fitDiagnostics } from "../../../lib/api/fitStats";
import type { CalcResult } from "../../../lib/types";
import { residualPlots } from "./residualPlotData";
import type { FittedData } from "./useCurveFit";

// The plots (uPlot) are their own chunk, fetched only once the section opens.
// React.lazy rather than lib/lazyRegion: a new lazyRegion importer chunk made
// the bundler split lazyRegion out of its eager home into a chunk of its own.
const ResidualPlotGrid = lazy(() => import("./ResidualPlotGrid"));
type Num = number | null;

/** uPlot reads `window.matchMedia` as its module loads; where it is missing
 *  (jsdom, a very old webview) the plots chunk would throw, so the section
 *  never opens BY ITSELF there -- an explicit click still tries. */
const canAutoDraw = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function";
/** Above this many residuals the section waits for a click: four uPlots and
 *  a diagnostics round trip on every re-fit are not free. */
const RESIDUALS_AUTO_OPEN_MAX = 5000;

export default function ResidualPlotsSection({
  result,
  fitData,
  xLabel,
  autoOpen = false,
  inView = true,
}: {
  result: CalcResult;
  fitData: FittedData;
  xLabel: string;
  /** Open whenever this turns true (UX-F: Curve Fit's Results tab is
   *  showing, so the residuals are one click -- the tab -- from anywhere).
   *  The user can still collapse it. */
  autoOpen?: boolean;
  /** False while the section is hidden (another Curve Fit tab): it neither
   *  fetches the Q-Q diagnostics nor draws, even when left open. */
  inView?: boolean;
}) {
  const residuals = result.residuals as Num[] | undefined;
  const yFit = result.yFit as Num[] | undefined;
  const auto = autoOpen && canAutoDraw() && (residuals?.length ?? 0) <= RESIDUALS_AUTO_OPEN_MAX;
  const [open, setOpen] = useState(auto);
  useEffect(() => {
    if (auto) setOpen(true);
  }, [auto]);
  const live = open && inView;
  const [qq, setQq] = useState<{ qqX: Num[]; qqY: Num[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQq(null);
    setError(null);
    if (!live || !Array.isArray(residuals)) return;
    const ctrl = new AbortController();
    const nParams = Number(result.nFree ?? (result.params as number[] | undefined)?.length ?? 0);
    fitDiagnostics({ y: fitData.y, residuals: residuals.map((v) => v ?? Number.NaN), n_params: nParams }, ctrl.signal)
      .then((d) => setQq({ qqX: d.residuals.qqX, qqY: d.residuals.qqY }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Q-Q plot failed");
      });
    return () => ctrl.abort();
  }, [live, result, residuals, fitData]);

  const plots = useMemo(
    () => (Array.isArray(residuals) && Array.isArray(yFit) ? residualPlots(fitData.x, yFit, residuals, xLabel, qq) : null),
    [residuals, yFit, fitData.x, xLabel, qq],
  );

  return (
    <details
      style={{ marginTop: 10 }}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="qzk-field-lbl">Residual plots</summary>
      {open && !plots && (
        <div className="qzk-helptext" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          This fit returned no residuals.
        </div>
      )}
      {live && plots && (
        <Suspense fallback={<div className="qzk-ds-meta">loading plots…</div>}>
          <ResidualPlotGrid plots={plots} qqNote={error ?? "computing Q-Q plot…"} qqFailed={error != null} />
        </Suspense>
      )}
    </details>
  );
}
