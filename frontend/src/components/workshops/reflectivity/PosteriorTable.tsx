// Reflectivity fit — the DREAM posterior beside the least-squares result (P2.2
// slice 4): per sampled parameter, the least-squares value ± stderr, the
// median with its 68% and 95% credible intervals, and R-hat (flagged above
// the threshold). A parameter whose interval the bounds, not the data, limit
// is marked. Stateless; reads a stored posterior summary.

import type { ReflFitParamResult } from "../../../lib/api/reflectivity";
import { formatNum } from "./reflFitModel";
import type { SavedPosterior } from "./reflPosterior";

const MONO = { fontFamily: "var(--font-mono)" } as const;
const COLS = "92px 1fr 1fr 1fr 44px";
const ROW = { display: "grid", gridTemplateColumns: COLS, gap: 4, fontSize: "var(--font-size-sm)" } as const;

const interval = ([lo, hi]: [number, number]): string => `${formatNum(lo)} – ${formatNum(hi)}`;

export default function PosteriorTable({ posterior, ls }: { posterior: SavedPosterior; ls: ReflFitParamResult[] }) {
  const lsBy = new Map(ls.map((p) => [p.name, p]));
  const thr = posterior.convergence.rhat_threshold;
  return (
    <div role="table" aria-label="posterior intervals">
      <div role="row" className="qzk-ds-meta" style={{ display: "grid", gridTemplateColumns: COLS, gap: 4 }}>
        <span role="columnheader">parameter</span>
        <span role="columnheader">least squares</span>
        <span role="columnheader">68% (median)</span>
        <span role="columnheader">95%</span>
        <span role="columnheader">R-hat</span>
      </div>
      {posterior.parameters.map((p) => {
        const l = lsBy.get(p.name);
        const flagged = p.rhat_flag || p.rhat == null;
        return (
          <div key={p.name} role="row" style={ROW}>
            <span role="rowheader" style={{ ...MONO, color: "var(--text-dim)" }}>
              {p.name}
              {p.tie ? ` = ${p.tie}` : ""}
            </span>
            <span role="cell" style={MONO}>
              {l ? `${formatNum(l.value)}${l.stderr == null ? "" : ` ± ${formatNum(l.stderr)}`}` : "—"}
            </span>
            <span role="cell" style={MONO} title={`median ${formatNum(p.median)}; best draw ${formatNum(p.map)}`}>
              {interval(p.interval68)}
            </span>
            <span
              role="cell"
              style={{ ...MONO, color: p.at_bound ? "var(--warn)" : undefined }}
              title={p.at_bound ? "the bounds, not the data, limit this interval — widen the bound, or fix or tie the parameter" : undefined}
            >
              {interval(p.interval95)}
              {p.at_bound ? " ⇤" : ""}
            </span>
            <span
              role="cell"
              style={{ ...MONO, color: flagged ? "var(--warn)" : "var(--ok)" }}
              title={flagged ? `above ${thr}: the chains have not mixed` : `at or below ${thr}`}
            >
              {p.rhat == null ? "—" : p.rhat.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
