// Film stack results table (plan G4): one row per layer, bottom to top.

import type { RsmPoint, StackResult } from "../../../../lib/api/filmStack";
import { Card, fmtNum } from "../shared";

/** Strain as a percentage with a sign, e.g. "+0.748 %". */
const pct = (x: number): string => `${x >= 0 ? "+" : ""}${fmtNum(x * 100)} %`;

function hcText(l: StackResult["layers"][number]): string {
  if (l.h_c_kind === "infinite") return "∞ (matched)";
  if (l.h_c_kind === "none" || l.h_c_nm == null) return "none";
  return fmtNum(l.h_c_nm);
}

const deg = (x: number | null): string => (x == null ? "–" : fmtNum(x));

function RsmRow({ name, p }: { name: string; p: RsmPoint }) {
  return (
    <tr>
      <td>{name}</td>
      <td>{fmtNum(p.qx)}</td>
      <td>{fmtNum(p.qz)}</td>
      <td>{deg(p.two_theta)}</td>
      <td>{deg(p.omega_gi)}</td>
      <td>{deg(p.omega_ge)}</td>
    </tr>
  );
}

export default function StackResults({ result }: { result: StackResult }) {
  const hl = result.rsm_reflection;
  return (
    <>
    <Card title="Strain by layer">
      <div style={{ overflowX: "auto" }}>
        <table className="qz-table" aria-label="stack results">
          <thead>
            <tr>
              <th>layer</th>
              <th>f vs below</th>
              <th>h_c (nm)</th>
              <th>state</th>
              <th>ε∥</th>
              <th>ε⊥</th>
              <th>c (Å)</th>
              <th>2θ (00L) (°)</th>
              <th>ε thermal</th>
            </tr>
          </thead>
          <tbody>
            {result.layers.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td>{pct(l.mismatch_pct / 100)}</td>
                <td>{hcText(l)}</td>
                <td>{l.state}</td>
                <td>{pct(l.eps_parallel)}</td>
                <td>{pct(l.eps_perp)}</td>
                <td>{fmtNum(l.c_strained)}</td>
                <td>{l.two_theta_00l.map((t) => (t == null ? "–" : fmtNum(t))).join(", ")}</td>
                <td>{pct(l.eps_thermal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        ε &lt; 0 is compressive. f = (a − a_below)/a_below. 2θ lists L = 1…4; “–” is out of reach at this λ.
      </div>
    </Card>
    {hl && result.substrate_rsm && (
      <Card title={`Predicted RSM peaks, (${hl[0]} 0 ${hl[1]})`}>
        <div style={{ overflowX: "auto" }}>
          <table className="qz-table" aria-label="predicted rsm peaks">
            <thead>
              <tr>
                <th />
                <th>Qx (Å⁻¹)</th>
                <th>Qz (Å⁻¹)</th>
                <th>2θ (°)</th>
                <th>ω, grazing in (°)</th>
                <th>ω, grazing out (°)</th>
              </tr>
            </thead>
            <tbody>
              <RsmRow name="substrate" p={result.substrate_rsm} />
              {result.layers.map((l, i) => l.rsm && <RsmRow key={i} name={l.name} p={l.rsm} />)}
            </tbody>
          </table>
        </div>
        <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
          Q = 2π/d, as in the RSM workshop. A coherent layer shares the substrate&apos;s Qx; a relaxed one sits at
          its own. “–” means out of reach at this λ or not reachable in that geometry.
        </div>
      </Card>
    )}
    </>
  );
}
