// Distribution workshop: the "Confidence intervals" section of the result
// book. Mean (t), median (distribution-free, exact coverage stated), standard
// deviation and variance (chi-square, normal data), and an optional bootstrap
// percentile interval for the mean and median with its fixed seed and resample
// count. The level is a percent field (default 95). "Copy table" puts the rows
// on the clipboard. Whole-column mode only; By mode has no CI section.

import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { DataTable } from "../../primitives/DataTable";
import { Switch } from "../../primitives/Switch";
import { CI_PERCENT_RANGE, ciTableText, type DistributionCi } from "./useDistributionCi";

const faint = { color: "var(--text-faint)" } as const;
const pct = (level: number): string => `${Number((level * 100).toPrecision(4))}%`;

/** The state lives in useDistribution (the saved result records the level and the switch). */
export default function DistributionCiSection({ ci, label }: { ci: DistributionCi; label: string }) {
  const setStatus = useApp((s) => s.setStatus);
  const rows = ci.result?.rows ?? [];
  const copy = () => {
    void navigator.clipboard.writeText(ciTableText(rows, ci.percent)).then(
      () => setStatus("copied the confidence intervals"),
      () => setStatus("could not copy the table", "danger"),
    );
  };
  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label className="qzk-field-lbl">Confidence level (%)</label>
          <BufferedNumberField aria-label="Confidence level" required width={64} min={CI_PERCENT_RANGE[0]} max={CI_PERCENT_RANGE[1]} value={ci.percent}
            onValue={(v) => v != null && ci.setPercent(v)} />
        </div>
        <Switch checked={ci.bootstrap} onChange={ci.setBootstrap} label="Bootstrap intervals" />
        <Button size="sm" disabled={rows.length === 0} onClick={copy}>Copy table</Button>
      </div>
      {ci.error && <div className="qzk-ds-meta" style={{ marginTop: 8, ...faint }}>{ci.error}</div>}
      {ci.busy && !ci.error && <div className="qzk-ds-meta" style={{ marginTop: 8, ...faint }}>computing…</div>}
      {ci.result && (
        <>
          <div className="qzk-ds-meta" style={{ marginTop: 8, ...faint }}>
            {label}: {ci.result.n} values{ci.result.n_dropped > 0 ? ` (${ci.result.n_dropped} non-numeric left out)` : ""}, {pct(ci.result.level)} requested.
          </div>
          <div style={{ overflowX: "auto", marginTop: 4 }}>
            <DataTable columns={["statistic", "method", "estimate", "lower", "upper", "coverage"]}
              rows={rows.map((r) => [r.statistic, r.method, fmtNum(r.estimate), r.low === null ? "—" : fmtNum(r.low), r.high === null ? "—" : fmtNum(r.high), pct(r.level)])} />
          </div>
          <ul className="qzk-ds-meta" style={{ margin: "6px 0 0", paddingLeft: 16, ...faint }}>
            {rows.filter((r) => r.note).map((r) => <li key={`${r.statistic}-${r.method}`}><strong>{r.statistic} ({r.method}):</strong> {r.note}</li>)}
          </ul>
        </>
      )}
    </>
  );
}
