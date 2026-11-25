// Time series workshop: each tool's numbers (the result book's summary section;
// the figures are its plot sections, ./TsResultBook). Lazy with the panel.

import type { StationarityTest } from "../../../lib/api/timeseries";
import type { TsResult } from "./timeSeriesRun";

export function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toString();
}

const meta = { color: "var(--text-faint)" } as const;
const th = { textAlign: "right", fontWeight: 400, color: "var(--text-faint)" } as const;
const mono = { textAlign: "right", fontFamily: "var(--font-mono)" } as const;

function pText(t: StationarityTest): string {
  return t.p_bound === "greater" ? `> ${fmt(t.p_value)}` : t.p_bound === "less" ? `< ${fmt(t.p_value)}` : fmt(t.p_value);
}

function TestTable({ tests }: { tests: StationarityTest[] }) {
  return (
    <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11 }}>
      <thead><tr><th style={{ ...th, textAlign: "left" }}>test</th><th style={th}>statistic</th><th style={th}>p</th><th style={th}>lags</th><th style={th}>5% crit.</th></tr></thead>
      <tbody>{tests.map((t) => (
        <tr key={t.test} title={`Null hypothesis: ${t.null}`}>
          <td>{t.test.toUpperCase()}</td><td style={mono}>{fmt(t.statistic)}</td><td style={mono}>{pText(t)}</td>
          <td style={mono}>{t.lags}</td><td style={mono}>{fmt(t.critical_values["5%"])}</td>
        </tr>))}</tbody>
    </table>
  );
}

export function Summary({ r }: { r: TsResult }) {
  if (r.tab === "stationarity") {
    const tests = [r.data.adf, r.data.kpss].filter((t): t is StationarityTest => !!t);
    return (
      <>
        <TestTable tests={tests} />
        <div className="qzk-ds-meta" style={{ marginTop: 6 }}>{r.data.verdict}</div>
        <div className="qzk-ds-meta" style={meta}>ADF: null is a unit root. KPSS: null is stationarity. A p beyond the printed table range is shown as a bound.</div>
      </>
    );
  }
  if (r.tab === "correlogram") {
    return (
      <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>Ljung-Box</th><th style={th}>Q</th><th style={th}>df</th><th style={th}>p</th></tr></thead>
        <tbody>{r.data.ljung_box.map((b) => (
          <tr key={b.lag}><td>lag {b.lag}</td><td style={mono}>{fmt(b.q)}</td><td style={mono}>{b.df}</td><td style={mono}>{fmt(b.p)}</td></tr>))}</tbody>
      </table>
    );
  }
  if (r.tab === "decompose") {
    const d = r.data;
    return (
      <div className="qzk-ds-meta">
        Period {d.period}, {d.model}. Seasonal strength {fmt(d.seasonal_strength, 3)} (share of the detrended variation the cycle explains).
        The first and last {Math.floor(d.period / 2)} trend values are undefined (centered average), not extrapolated.
      </div>
    );
  }
  if (r.tab === "changepoint") {
    const d = r.data;
    return (
      <>
        <div className="qzk-ds-meta">{d.changepoints.length} change point{d.changepoints.length === 1 ? "" : "s"}; penalty {fmt(d.penalty_used)} per change ({d.penalty}).</div>
        <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11, marginTop: 4 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>segment</th><th style={th}>rows</th><th style={th}>n</th><th style={th}>mean</th><th style={th}>sd</th></tr></thead>
          <tbody>{d.segments.map((s, i) => (
            <tr key={s.start}><td>{i + 1}</td><td style={mono}>{s.start + 1}–{s.end + 1}</td><td style={mono}>{s.n}</td><td style={mono}>{fmt(s.mean)}</td><td style={mono}>{fmt(s.sd)}</td></tr>))}</tbody>
        </table>
      </>
    );
  }
  const d = r.data;
  return (
    <>
      <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>term</th><th style={th}>estimate</th><th style={th}>s.e.</th><th style={th}>p</th></tr></thead>
        <tbody>{d.params.map((p) => (
          <tr key={p.name}><td>{p.name}</td><td style={mono}>{fmt(p.estimate)}</td><td style={mono}>{fmt(p.se)}</td><td style={mono}>{fmt(p.p)}</td></tr>))}</tbody>
      </table>
      <div className="qzk-ds-meta" style={{ marginTop: 4 }}>AIC {fmt(d.aic, 6)} · BIC {fmt(d.bic, 6)} · log-likelihood {fmt(d.loglik, 6)}</div>
      {d.notes.map((n) => <div key={n} className="qzk-ds-meta" style={{ color: "var(--warn, var(--text-faint))" }}>{n}</div>)}
    </>
  );
}
