// Effects of a two-level design (GAP_AUDIT_9 J16): contrast effects with
// Lenth's pseudo standard error (calc/doe_effects.py), as a Pareto-ordered
// table and a half-normal plot. The way to read an unreplicated or saturated
// design, where Fit Model has no error degrees of freedom. Daniel 1959;
// Lenth 1989.

import { useEffect, useMemo, useState } from "react";

import { doeEffects, type DoeEffectsResponse } from "../../../lib/api/doe";
import { doeEffectsBody, filledResponses, plainTerm } from "../../../lib/doe";
import { fmtNum } from "../../../lib/format";
import type { DoeMeta } from "../../../lib/doe";
import type { DataStruct, Dataset } from "../../../lib/types";
import { DoeEffectsBook } from "./DoeResultBooks";
import HalfNormalPlot from "./HalfNormalPlot";

const hint = { color: "var(--text-faint)" } as const;

/** With `active` and `meta`, the effects show as a result book (Save result, table actions). */
export default function DoeEffects({ data, active, meta }: { data: DataStruct; active?: Dataset; meta?: DoeMeta }) {
  const enough = filledResponses(data) >= 4;
  const body = useMemo(() => (enough ? doeEffectsBody(data) : null), [data, enough]);
  const [res, setRes] = useState<{ body: unknown; out: DoeEffectsResponse | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!body) return;
    const c = new AbortController();
    doeEffects(body, c.signal).then(
      (out) => { if (!c.signal.aborted) setRes({ body, out, error: null }); },
      (e: unknown) => { if (!c.signal.aborted) setRes({ body, out: null, error: e instanceof Error ? e.message : "Effects failed" }); },
    );
    return () => c.abort();
  }, [body]);
  const cur = res && res.body === body ? res : null;
  if (!enough) return <div className="qzk-ds-meta" style={{ ...hint, marginTop: 8 }}>The effects appear once at least 4 runs have a response.</div>;
  if (!body) return null;
  return (
    <details style={{ marginTop: 8 }} open>
      <summary className="qzk-ds-meta">Effects (Pareto and half-normal)</summary>
      {!cur && <div className="qzk-ds-meta" style={hint}>computing…</div>}
      {cur?.error && <div className="qzk-ds-meta" style={hint}>{cur.error}</div>}
      {cur?.out && (active && meta && active.data === data
        ? <DoeEffectsBook active={active} meta={meta} out={cur.out}><EffectsView out={cur.out} /></DoeEffectsBook>
        : <EffectsView out={cur.out} />)}
    </details>
  );
}

function EffectsView({ out }: { out: DoeEffectsResponse }) {
  const maxAbs = Math.max(...out.effects.map((e) => e.abs_effect), 1e-12);
  return (
    <div>
      <div className="qzk-ds-meta" style={hint}>
        {out.n_runs} runs.{" "}
        {out.pse !== null ? `Lenth PSE ${fmtNum(out.pse)}, margin of error ${fmtNum(out.me ?? NaN)}, simultaneous ${fmtNum(out.sme ?? NaN)}.`
          : "Too few effects for a Lenth estimate."}{" "}
        In a fraction an effect is the sum of its aliases.
      </div>
      <table className="qzk-ds-meta" aria-label="Effects" style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
        <thead><tr><th align="left">Term</th><th align="right">Effect</th><th align="right">t (Lenth)</th><th style={{ width: "40%" }}>|effect|</th></tr></thead>
        <tbody>
          {out.effects.map((e) => (
            <tr key={e.term}>
              <td>{plainTerm(e.term)}{e.significant ? " *" : ""}</td>
              <td align="right" style={{ fontFamily: "var(--font-mono)" }}>{fmtNum(e.effect)}</td>
              <td align="right" style={{ fontFamily: "var(--font-mono)" }}>{e.t_ratio === null ? "" : fmtNum(e.t_ratio)}</td>
              <td><div style={{ height: 8, width: `${(100 * e.abs_effect) / maxAbs}%`, background: e.significant ? "var(--accent)" : "var(--text-faint)" }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="qzk-ds-meta" style={hint}>* beyond the simultaneous margin of error (Lenth 1989).</div>
      <HalfNormalPlot rows={out.effects} />
    </div>
  );
}
