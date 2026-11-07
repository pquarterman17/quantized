// Live, read-only calculation summary shown before Apply (MAIN_PLAN #42):
// computed area/volume (or mass), the divisor, source and output units, the
// overall factor, and the equations. Recomputed from the form every render.

import { fmtNum } from "../../../lib/format";
import type { NormalizationSummary } from "../../../lib/sampleNormalization";

const BASIS_TEXT = { none: "none (raw moment)", mass: "mass", area: "area", volume: "volume" } as const;

function Row({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}

const withUnit = (v: number | null, unit: string): string => (v === null ? "—" : `${fmtNum(v)} ${unit}`);

export function NormalizationSummaryView({ summary }: { summary: NormalizationSummary }) {
  const s = summary;
  const ready = s.problem === null;
  return (
    <section className="qz-mag-summary" aria-label="Calculation summary">
      <dl>
        <Row term="Source moment" value={s.fromMoment} />
        <Row term="Output unit" value={s.toMoment || "—"} />
        <Row term="Basis" value={BASIS_TEXT[s.basis]} />
        {s.basis === "mass" && <Row term="Mass" value={ready ? withUnit(s.massG, "g") : "—"} />}
        {(s.basis === "area" || s.basis === "volume") && s.geometry !== "volume" && (
          <Row term="Computed area" value={ready ? withUnit(s.areaCm2, "cm²") : "—"} />
        )}
        {s.basis === "volume" && <Row term="Computed volume" value={ready ? withUnit(s.volumeCm3, "cm³") : "—"} />}
        {s.basis !== "none" && <Row term="Divisor" value={ready ? withUnit(s.divisor, s.divisorUnit) : "—"} />}
        <Row term="Factor" value={ready && s.factor !== null ? `× ${fmtNum(s.factor)}` : "—"} />
        <Row term="Equation" value={s.toMoment ? s.equation : "—"} />
        {ready && s.geometryEquation && <Row term="Geometry" value={s.geometryEquation} />}
      </dl>
    </section>
  );
}
