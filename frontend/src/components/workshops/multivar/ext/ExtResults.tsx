// PLS / LDA / spectra PCA tab: the result readout (view): figures drawn by the
// shared SmallUPlot plus each tool's numbers. Lazy with the tab.

import SmallUPlot from "../../SmallUPlot";
import type { ExtFigure } from "./multivarExtOutputs";
import type { ExtMeta, ExtResult } from "./multivarExtRun";

export function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toString();
}

const th = { textAlign: "right", fontWeight: 400, color: "var(--text-faint)" } as const;
const mono = { textAlign: "right", fontFamily: "var(--font-mono)" } as const;
const faint = { color: "var(--text-faint)" } as const;

function PlsSummary({ r, meta }: { r: Extract<ExtResult, { tool: "pls" }>; meta: ExtMeta }) {
  const d = r.data;
  return (
    <>
      <div className="qzk-ds-meta">
        {d.n_components} component{d.n_components === 1 ? "" : "s"} ({d.auto_components ? "chosen by smallest PRESS" : "fixed"}); n = {d.n}, {d.p} variables;
        {" "}{d.cv.folds}-fold CV, seed {d.cv.seed}; {d.preprocess}.
      </div>
      <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11, marginTop: 4 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>response</th><th style={th}>R²Y</th><th style={th}>Q²</th><th style={th}>RMSEC</th><th style={th}>RMSECV</th></tr></thead>
        <tbody>{meta.yLabels.map((y, k) => (
          <tr key={y}><td>{y}</td><td style={mono}>{fmt(d.r2y[k])}</td><td style={mono}>{fmt(d.q2[k])}</td><td style={mono}>{fmt(d.rmsec[k])}</td><td style={mono}>{fmt(d.rmsecv[k])}</td></tr>))}</tbody>
      </table>
      <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11, marginTop: 6 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>comp.</th><th style={th}>R²X</th><th style={th}>cum. R²Y</th><th style={th}>Q² (mean)</th></tr></thead>
        <tbody>{d.r2y_cumulative.map((c, i) => (
          <tr key={i} style={i + 1 === d.cv.best ? { fontWeight: 600 } : undefined} title={i + 1 === d.cv.best ? "Smallest PRESS" : undefined}>
            <td>{i + 1}</td><td style={mono}>{fmt(d.r2x[i])}</td>
            <td style={mono}>{fmt(c.reduce<number>((s, v) => s + (v ?? 0), 0) / c.length)}</td><td style={mono}>{fmt(d.cv.q2_mean[i])}</td>
          </tr>))}</tbody>
      </table>
      <div className="qzk-ds-meta" style={faint}>Bold row: the component count with the smallest cross-validated PRESS. Q² = 1 − PRESS/SST.</div>
    </>
  );
}

function LdaSummary({ r }: { r: Extract<ExtResult, { tool: "lda" }> }) {
  const d = r.data;
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  return (
    <>
      <div className="qzk-ds-meta">
        {d.classes.length} classes, {d.p} variables, n = {d.n}; resubstitution accuracy {pct(d.accuracy)}
        {d.cv ? `; ${d.cv.folds}-fold CV accuracy ${pct(d.cv.accuracy)} (seed ${d.cv.seed})` : ""}. Priors: {d.priors_mode}.
      </div>
      <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11, marginTop: 4 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>true \ predicted</th>{d.classes.map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
        <tbody>{d.confusion.map((rowv, i) => (
          <tr key={d.classes[i]}><td>{d.classes[i]}</td>{rowv.map((v, j) => <td key={j} style={mono}>{v}</td>)}</tr>))}</tbody>
      </table>
      <div className="qzk-ds-meta" style={faint}>
        Variance explained by discriminant: {d.explained_variance_ratio.map((v, i) => `LD${i + 1} ${pct(v)}`).join(", ")}.
        {d.cv ? ` CV confusion: ${d.cv.confusion.map((c) => `[${c.join(" ")}]`).join(" ")}.` : " Without CV the accuracy is optimistic."}
      </div>
    </>
  );
}

function SpectraSummary({ r }: { r: Extract<ExtResult, { tool: "spectra" }> }) {
  const d = r.data;
  return (
    <>
      <div className="qzk-ds-meta">{d.n_spectra} spectra on a {d.grid.length}-point grid.</div>
      {d.notes.map((n) => <div key={n} className="qzk-ds-meta" style={{ color: "var(--warn, var(--text-faint))" }}>{n}</div>)}
      <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11, marginTop: 4 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>PC</th><th style={th}>explained %</th><th style={th}>cumulative %</th></tr></thead>
        <tbody>{d.explained.slice(0, 8).map((e, i) => (
          <tr key={i}><td>{i + 1}</td><td style={mono}>{fmt(e)}</td><td style={mono}>{fmt(d.cumulative[i])}</td></tr>))}</tbody>
      </table>
    </>
  );
}

export default function ExtResults({ result, meta, figures }: { result: ExtResult; meta: ExtMeta; figures: ExtFigure[] }) {
  return (
    <div style={{ marginTop: 12 }}>
      {meta.dropped > 0 && (
        <div className="qzk-ds-meta" style={{ color: "var(--warn, var(--text-faint))" }}>
          {meta.dropped} row{meta.dropped === 1 ? "" : "s"} with a blank or non-finite value in a used column were left out (listwise).
        </div>
      )}
      {figures.map((f) => (
        <div key={f.key} style={{ marginBottom: 6 }}>
          <div className="qzk-ds-meta" style={faint}>{f.title}</div>
          <SmallUPlot payload={f.payload} label={f.title} height={170} refLines={f.refLines} compact />
        </div>
      ))}
      {result.tool === "pls" && <PlsSummary r={result} meta={meta} />}
      {result.tool === "lda" && <LdaSummary r={result} />}
      {result.tool === "spectra" && <SpectraSummary r={result} />}
    </div>
  );
}
