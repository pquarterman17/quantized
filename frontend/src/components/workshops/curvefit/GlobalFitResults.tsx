// Curve Fit — Global fit results: shared values once, each series' own values,
// per-series goodness of fit with a "Show" that puts that series' curve on its
// plot, and "→ Report" into the Library. Fed by useGlobalFit.

import { Button } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import FitConvergenceWarning from "./FitConvergenceWarning";
import { resultRows } from "./globalFitData";
import type { GlobalFitState } from "./useGlobalFit";

export default function GlobalFitResults({ s }: { s: GlobalFitState }) {
  if (!s.result) return null;
  const { fit, members } = s.result;
  const rows = resultRows(fit, members);

  return (
    <div style={{ marginTop: 10 }}>
      <FitConvergenceWarning result={{ exitFlag: fit.exitFlag }} />
      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6 }}>
        <table className="qz-table" aria-label="Global fit parameters">
          <thead>
            <tr>
              <th>param</th>
              <th>series</th>
              <th>value</th>
              <th>± err</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={r.dataset === "shared" ? { fontWeight: 600 } : undefined}>
                <td>{r.param}</td>
                <td>{r.dataset}</td>
                <td>{fmt(r.value)}</td>
                <td>{fmt(r.error)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <table className="qz-table" aria-label="Global fit per series" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>series</th>
            <th>R²</th>
            <th>RMSE</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => (
            <tr key={`${m.datasetId}:${m.yKey}`}>
              <td>{m.label}</td>
              <td>{fmt(fit.R2[i])}</td>
              <td>{fmt(fit.RMSE[i])}</td>
              <td>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={s.shownIndex === i}
                  aria-label={`Show ${m.label} fit`}
                  title="Draw this series' fitted curve on its plot"
                  onClick={() => s.show(i)}
                >
                  {s.shownIndex === i ? "● Shown" : "Show"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
        reduced χ² {fmt(fit.chiSqRed)} · {fit.nFree} free parameters · {fit.nTotal} points
      </div>
      <div style={{ marginTop: 8 }}>
        <Button size="sm" disabled={s.reporting} onClick={() => void s.toReport()}>
          {s.reporting ? "Reporting…" : "→ Report"}
        </Button>
      </div>
    </div>
  );
}
