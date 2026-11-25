// DOE setup form (GAP_AUDIT_9 J16): design type, factors with their low/high
// settings and units, the design's own options, run order, and Generate.

import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { BlockingOptions, OptimalOptions } from "./DoeExtOptions";
import { DESIGN_OPTIONS, isFactorial, kRange, type DoeState } from "./useDoe";

const ALPHAS = [
  { value: "rotatable", label: "Rotatable (alpha = F^1/4)" },
  { value: "face_centered", label: "Face-centered (alpha = 1)" },
  { value: "orthogonal", label: "Orthogonal" },
  { value: "custom", label: "Custom…" },
];

const hint = { color: "var(--text-faint)" } as const;

export default function DoeSetup({ d }: { d: DoeState }) {
  const { setup: s, update } = d;
  const [lo, hi] = kRange(s.design);
  const optimal = s.design === "d_optimal";
  const twoLevel = s.design === "full_factorial" || s.design === "fractional_factorial" || s.design === "plackett_burman";
  const defaultCenter = d.fractions
    ? (s.design === "ccd" ? (s.ccdFractional ? d.fractions.center_points.ccd_fractional : d.fractions.center_points.ccd)
      : s.design === "box_behnken" ? d.fractions.center_points.box_behnken : 0)
    : 0;
  return (
    <div>
      <label className="qzk-field-lbl" htmlFor="doe-design">Design</label>
      <Select id="doe-design" aria-label="Design" options={DESIGN_OPTIONS} value={s.design}
        onChange={(e) => update({ design: e.target.value as typeof s.design })} />
      <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="qzk-field-lbl" htmlFor="doe-k">Factors ({lo}-{hi})</label>
          <NumberField id="doe-k" aria-label="Number of factors" value={s.k} width={56}
            onChange={(v) => { const n = Math.round(Number(v)); if (Number.isFinite(n) && n >= 1 && n <= 30) update({ k: n }); }} />
        </div>
        <div>
          <label className="qzk-field-lbl" htmlFor="doe-response">Response name</label>
          <input id="doe-response" className="qz-input" style={{ width: 120 }} value={s.responseName}
            onChange={(e) => update({ responseName: e.target.value })} />
        </div>
        {s.design === "plackett_burman" && (
          <div>
            <label className="qzk-field-lbl" htmlFor="doe-runs">Runs</label>
            <Select id="doe-runs" aria-label="Runs" value={String(s.runs)} onChange={(e) => update({ runs: Number(e.target.value) })}
              options={[12, 20, 24].map((n) => ({ value: String(n), label: `${n} (up to ${n - 1} factors)` }))} />
          </div>
        )}
        {s.design === "fractional_factorial" && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="qzk-field-lbl" htmlFor="doe-p">Fraction (published generators)</label>
            <Select id="doe-p" aria-label="Fraction" value={String(s.p ?? "")} onChange={(e) => update({ p: Number(e.target.value) })}
              options={(d.fractions?.fractions ?? []).map((f) => ({
                value: String(f.p), label: `2^(${s.k}-${f.p}): ${f.runs} runs, resolution ${["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"][f.resolution]}`,
              }))} />
          </div>
        )}
        {s.design === "ccd" && (
          <>
            <div>
              <label className="qzk-field-lbl" htmlFor="doe-alpha">Alpha</label>
              <Select id="doe-alpha" aria-label="Alpha" options={ALPHAS} value={s.alpha}
                onChange={(e) => update({ alpha: e.target.value as typeof s.alpha })} />
            </div>
            {s.alpha === "custom" && (
              <NumberField aria-label="Custom alpha" value={s.alphaCustom} width={64} onChange={(v) => update({ alphaCustom: v })} />
            )}
          </>
        )}
      </div>
      {isFactorial(s.design) && <BlockingOptions d={d} />}
      {optimal && <OptimalOptions d={d} />}
      <div role="group" aria-label="Factors" style={{ marginTop: 8, display: "grid", gridTemplateColumns: optimal ? "1fr 72px 72px 64px 1fr" : "1fr 72px 72px 64px", gap: 4, alignItems: "center" }}>
        <span className="qzk-ds-meta" style={hint}>Name</span>
        <span className="qzk-ds-meta" style={hint}>Low</span>
        <span className="qzk-ds-meta" style={hint}>High</span>
        <span className="qzk-ds-meta" style={hint}>Unit</span>
        {optimal && <span className="qzk-ds-meta" style={hint}>Levels (categorical)</span>}
        {s.factors.map((_f, i) => (
          <FactorRowFields key={i} i={i} d={d} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        {twoLevel && (
          <div>
            <label className="qzk-field-lbl" htmlFor="doe-reps">Replicates</label>
            <NumberField id="doe-reps" aria-label="Replicates" value={s.replicates} width={56} onChange={(v) => update({ replicates: v })} />
          </div>
        )}
        {!optimal && (
          <div>
            <label className="qzk-field-lbl" htmlFor="doe-center">Center points</label>
            <NumberField id="doe-center" aria-label="Center points" value={s.center} width={56} placeholder={String(defaultCenter)}
              onChange={(v) => update({ center: v })} />
          </div>
        )}
        <Checkbox checked={s.randomize} onChange={(v) => update({ randomize: v })}>Randomize run order</Checkbox>
        {s.randomize && !optimal && (
          <div>
            <label className="qzk-field-lbl" htmlFor="doe-seed">Seed (blank = new)</label>
            <NumberField id="doe-seed" aria-label="Seed" value={s.seed} width={80} onChange={(v) => update({ seed: v })} />
          </div>
        )}
        {s.design === "ccd" && (
          <>
            <Checkbox checked={s.inscribed} onChange={(v) => update({ inscribed: v })}
              title="Star points at the low/high settings; the factorial points sit inside them (CCI)">Inscribed</Checkbox>
            <Checkbox checked={s.ccdFractional} disabled={s.k < 5} onChange={(v) => update({ ccdFractional: v })}
              title="Resolution V fraction as the factorial portion (5 to 8 factors)">Fractional factorial portion</Checkbox>
          </>
        )}
      </div>
      {/* D-optimal designs have no center points (the runs are chosen by the optimizer), so the note does not apply. */}
      {!optimal && (
        <div className="qzk-ds-meta" style={{ ...hint, marginTop: 6 }}>
          Response-surface designs start with the published number of center points (NIST e-Handbook Table 3.28) and
          two-level designs with none. The run order is randomized, with the seed recorded so a design can be regenerated.
        </div>
      )}
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <Button size="sm" disabled={!!d.problem || d.busy} onClick={() => void d.generate()}>Generate worksheet</Button>
        {d.busy && <span className="qzk-ds-meta" style={hint}>generating…</span>}
      </div>
      {d.problem && <div className="qzk-ds-meta" style={{ ...hint, marginTop: 6 }}>{d.problem}</div>}
      {d.error && <div className="qzk-ds-meta" role="alert" style={{ color: "var(--warn, var(--text-faint))", marginTop: 6 }}>{d.error}</div>}
    </div>
  );
}

function FactorRowFields({ i, d }: { i: number; d: DoeState }) {
  const f = d.setup.factors[i]!;
  return (
    <>
      <input aria-label={`Factor ${i + 1} name`} className="qz-input" value={f.name} onChange={(e) => d.setFactor(i, { name: e.target.value })} />
      <NumberField aria-label={`Factor ${i + 1} low`} value={f.low} width={72} onChange={(v) => d.setFactor(i, { low: v })} />
      <NumberField aria-label={`Factor ${i + 1} high`} value={f.high} width={72} onChange={(v) => d.setFactor(i, { high: v })} />
      <input aria-label={`Factor ${i + 1} unit`} className="qz-input" value={f.unit} onChange={(e) => d.setFactor(i, { unit: e.target.value })} />
      {d.setup.design === "d_optimal" && (
        <input aria-label={`Factor ${i + 1} levels`} className="qz-input" placeholder="blank = continuous" value={f.levels}
          onChange={(e) => d.setFactor(i, { levels: e.target.value })} />
      )}
    </>
  );
}
