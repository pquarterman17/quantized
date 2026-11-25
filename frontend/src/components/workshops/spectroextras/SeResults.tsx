// Spectroscopy extras workshop: the readout under Run (view).

import SmallUPlot from "../SmallUPlot";
import type { SeFigure } from "./spectroOutputs";
import type { SeResult } from "./spectroRun";

const meta = { marginBottom: 2 } as const;
const mono = { fontFamily: "var(--font-mono)", textAlign: "right" } as const;
const th = { textAlign: "right", fontWeight: 500 } as const;
const g = (v: number): string => Number(v.toPrecision(6)).toString();

function Summary({ r }: { r: SeResult }) {
  if (r.tab === "fsd") {
    const i = r.runs[0]?.res.info;
    return i ? (
      <div className="qzk-ds-meta">
        {r.runs.length} column{r.runs.length === 1 ? "" : "s"} · line FWHM {g(i.fwhm_in)} to {g(i.fwhm_out)} (K = {g(i.k)}, {i.apodization}) · cutoff {g(i.cutoff)} · noise gain ×{g(i.noise_gain)} rms · K at most {g(i.k_max)} for this sampling
      </div>
    ) : null;
  }
  if (r.tab === "corr2d") {
    const d = r.data.info;
    return <div className="qzk-ds-meta">{d.spectra} spectra, {d.points} × {d.points} maps (synchronous and asynchronous). "Add as worksheet" writes both as map datasets: plot them with the map plot. In Φ·Ψ terms, same sign means the change at X1 comes before X2 (Noda's rule).</div>;
  }
  return (
    <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11 }}>
      <thead><tr><th style={{ ...th, textAlign: "left" }}>column</th><th style={th}>tangent onset</th><th style={th}>threshold onset</th><th style={th}>top</th></tr></thead>
      <tbody>{r.runs.map(({ label, res }) => (
        <tr key={label}><td>{label}</td><td style={mono}>{g(res.tangent.x_onset)}</td><td style={mono}>{g(res.threshold.x_onset)}</td><td style={mono}>{g(res.top.x)}</td></tr>))}</tbody>
    </table>
  );
}

export default function SeResults({ result, figures }: { result: SeResult; figures: SeFigure[] }) {
  return (
    <div style={{ marginTop: 12 }}>
      {figures.map((f) => (
        <div key={f.key} style={{ marginBottom: 6 }}>
          <div className="qzk-ds-meta" style={meta}>{f.title}</div>
          <SmallUPlot payload={f.payload} label={f.title} height={170} compact />
        </div>
      ))}
      <Summary r={result} />
    </div>
  );
}
