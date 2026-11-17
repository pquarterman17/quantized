// Peaks workshop — the fitted-peak table's header strip: model, the fit's
// metrics and, for a simultaneous fit, its quality verdict in the tone
// lib/peakFitStatus gives it (UX audit 9 #3: a fit stuck at R² 0.94 read as a
// plain line of numbers). Split from PeaksPanel to keep it under the .tsx
// ceiling.

import { StatusDot } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { peakFitStatus } from "../../../lib/peakFitStatus";
import type { MultiFitResult, PeakTable } from "../../../lib/peakTable";

const faint = { color: "var(--text-faint)" } as const;

interface Props {
  /** The durable table's provenance when paired with the shown rows, else the local fit. */
  metrics: PeakTable["provenance"] | MultiFitResult | null;
  /** Whether the durable table is paired with the shown rows. */
  paired: boolean;
  peakTable: PeakTable | null;
  modelFit: boolean;
  edited: number;
  excluded: number;
}

export default function PeakFitSummary({ metrics, paired, peakTable, modelFit, edited, excluded }: Props) {
  const independent = paired && peakTable?.provenance.method === "independent";
  // Judged only for a simultaneous fit that recorded its quality: a model fit
  // reports its own warnings, and an independent fit has no global R².
  const judged = !!metrics?.solver && !modelFit && !independent;
  const status = judged && metrics ? peakFitStatus(metrics) : null;
  return (
    <div className="qzk-ds-meta" style={{ ...faint, marginBottom: 4 }}>
      {metrics?.model} ·{" "}
      {metrics?.R2 != null
        ? `R² = ${fmtNum(metrics.R2)}`
        : !paired
          ? "" // table not yet paired with this fit (one frame on a switch)
          : independent
            ? "independent fits"
            : modelFit && peakTable?.provenance.ssr != null
              ? "R² undefined" // an unedited model fit (SSR clears with R² on any edit)
              : "fit metrics cleared by manual changes"}
      {modelFit && " · Peak analyzer model fit"}
      {edited > 0 && ` · ${edited} edited by hand`}
      {metrics?.rmse != null && ` · RMSE = ${fmtNum(metrics.rmse)}`}
      {excluded > 0 && ` · ${excluded} excluded`}
      {status && (
        <div data-fit-status={status.tone} style={{ marginTop: 2 }}>
          <StatusDot
            tone={status.tone}
            label={status.tone === "warn" ? status.text.split(" · ")[0] : "Converged · ± 1σ from the fit covariance"}
          />
        </div>
      )}
    </div>
  );
}
