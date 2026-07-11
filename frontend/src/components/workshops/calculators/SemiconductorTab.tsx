// Calculators ▸ Semiconductor tab — intrinsic carrier conc / carrier conc /
// depletion width / diffusion coeff + length / Fermi level / Debye length /
// built-in potential / sheet carrier density / thermal velocity / Hall coeff /
// mobility model (calc.semiconductor, ports DiraCulator buildSemiconductorTab).
// Self-contained: a declarative card spec over its own local field-value map so
// the shared useCalculators hook stays under the ceiling. Math is golden in
// calc.semiconductor on the backend.

import { useState } from "react";

import {
  semiconductorBuiltInPotential,
  semiconductorCarrierConc,
  semiconductorDebyeLength,
  semiconductorDepletionWidth,
  semiconductorDiffusionCoeff,
  semiconductorDiffusionLength,
  semiconductorFermiLevel,
  semiconductorHallCoefficient,
  semiconductorIntrinsic,
  semiconductorMobilityModel,
  semiconductorSheetCarrierDensity,
  semiconductorThermalVelocity,
} from "../../../lib/api";
import {
  Button,
  Card,
  Field,
  ROW,
  fmtNum,
  makeCardRunner,
  resultLine,
  type CardResult,
} from "./shared";

const runCard = makeCardRunner("Semiconductor");

// Material presets (300 K) mirrored from calc.semiconductor.materialPresets so
// the dropdowns auto-fill without a round-trip. Eg [eV], eps_r, me*, mh*.
const MATERIALS: Record<string, { Eg: number; eps_r: number; me: number; mh: number }> = {
  Si: { Eg: 1.12, eps_r: 11.7, me: 1.08, mh: 0.81 },
  Ge: { Eg: 0.66, eps_r: 16.0, me: 0.55, mh: 0.37 },
  GaAs: { Eg: 1.42, eps_r: 12.9, me: 0.067, mh: 0.45 },
  InP: { Eg: 1.35, eps_r: 12.5, me: 0.08, mh: 0.6 },
  GaN: { Eg: 3.4, eps_r: 8.9, me: 0.2, mh: 1.4 },
  SiC: { Eg: 3.26, eps_r: 9.7, me: 0.37, mh: 1.0 },
};
const MAT_NAMES = Object.keys(MATERIALS);
const NM_TO_CM = 1e-7;

type Vals = Record<string, string>;
/** Picks one preset field into a form field, optionally transformed. */
type Fill = { from: keyof (typeof MATERIALS)["Si"]; to: string }[];

interface FieldSpec {
  id: string;
  label: string;
  unit?: string;
  width?: number;
  default: string;
}
interface CardSpec {
  title: string;
  fields: FieldSpec[];
  material?: Fill; // when set, render a preset dropdown that fills `to` ids
  compute: (n: (id: string) => number) => Promise<string>;
}

const CARDS: CardSpec[] = [
  {
    title: "Intrinsic carrier concentration",
    material: [
      { from: "Eg", to: "ni_eg" },
      { from: "me", to: "ni_me" },
      { from: "mh", to: "ni_mh" },
    ],
    fields: [
      { id: "ni_eg", label: "Eg", unit: "eV", width: 64, default: "1.12" },
      { id: "ni_me", label: "mₑ*", width: 60, default: "1.08" },
      { id: "ni_mh", label: "m_h*", width: 60, default: "0.81" },
      { id: "ni_t", label: "T", unit: "K", width: 56, default: "300" },
    ],
    compute: async (n) => {
      const r = await semiconductorIntrinsic(n("ni_eg"), n("ni_me"), n("ni_mh"), n("ni_t"));
      return `nᵢ = ${fmtNum(r.ni)} cm⁻³ · Nc = ${fmtNum(r.Nc)} · Nv = ${fmtNum(r.Nv)}`;
    },
  },
  {
    title: "Carrier concentrations",
    fields: [
      { id: "cc_nd", label: "Nd", unit: "cm⁻³", width: 72, default: "1e16" },
      { id: "cc_na", label: "Na", unit: "cm⁻³", width: 72, default: "0" },
      { id: "cc_ni", label: "nᵢ", unit: "cm⁻³", width: 72, default: "1.5e10" },
    ],
    compute: async (n) => {
      const r = await semiconductorCarrierConc(n("cc_nd"), n("cc_na"), n("cc_ni"));
      return `n = ${fmtNum(r.n)} · p = ${fmtNum(r.p)} cm⁻³ · ${r.type}-type`;
    },
  },
  {
    title: "Depletion width (p-n junction)",
    material: [{ from: "eps_r", to: "dw_eps" }],
    fields: [
      { id: "dw_eps", label: "εᵣ", width: 60, default: "11.7" },
      { id: "dw_vbi", label: "Vbi", unit: "V", width: 60, default: "0.7" },
      { id: "dw_na", label: "Na", unit: "cm⁻³", width: 72, default: "1e16" },
      { id: "dw_nd", label: "Nd", unit: "cm⁻³", width: 72, default: "1e17" },
    ],
    compute: async (n) => {
      const r = await semiconductorDepletionWidth(n("dw_vbi"), n("dw_na"), n("dw_nd"), n("dw_eps"), 300);
      return `W = ${fmtNum(r.W)} nm · xₙ = ${fmtNum(r.xn)} · xₚ = ${fmtNum(r.xp)} nm`;
    },
  },
  {
    title: "Transport (diffusion coefficient & length)",
    fields: [
      { id: "tr_mu", label: "μ", unit: "cm²/V·s", width: 72, default: "1400" },
      { id: "tr_tau", label: "τ", unit: "s", width: 72, default: "1e-6" },
    ],
    compute: async (n) => {
      const d = await semiconductorDiffusionCoeff(n("tr_mu"), 300);
      const l = await semiconductorDiffusionLength(d.D, n("tr_tau"));
      return `D = ${fmtNum(d.D)} cm²/s · L = ${fmtNum(l.Lum)} µm`;
    },
  },
  {
    title: "Fermi level (relative to Eᵢ)",
    fields: [
      { id: "fl_eg", label: "Eg", unit: "eV", width: 56, default: "1.12" },
      { id: "fl_me", label: "mₑ*", width: 52, default: "1.08" },
      { id: "fl_mh", label: "m_h*", width: 52, default: "0.81" },
      { id: "fl_nd", label: "Nd", unit: "cm⁻³", width: 64, default: "1e16" },
      { id: "fl_na", label: "Na", unit: "cm⁻³", width: 64, default: "0" },
      { id: "fl_t", label: "T", unit: "K", width: 52, default: "300" },
    ],
    compute: async (n) => {
      const r = await semiconductorFermiLevel(
        n("fl_eg"),
        n("fl_me"),
        n("fl_mh"),
        n("fl_nd"),
        n("fl_na"),
        n("fl_t"),
      );
      return `E_F − Eᵢ = ${fmtNum(r.EF)} eV · ${r.type}-type`;
    },
  },
  {
    title: "Debye screening length",
    fields: [
      { id: "dl_eps", label: "εᵣ", width: 60, default: "11.7" },
      { id: "dl_n", label: "n", unit: "cm⁻³", width: 72, default: "1e16" },
      { id: "dl_t", label: "T", unit: "K", width: 56, default: "300" },
    ],
    compute: async (n) => {
      const r = await semiconductorDebyeLength(n("dl_n"), n("dl_eps"), n("dl_t"));
      return `L_D = ${fmtNum(r.LD)} nm`;
    },
  },
  {
    title: "Built-in potential (p-n junction)",
    fields: [
      { id: "bv_na", label: "Na", unit: "cm⁻³", width: 64, default: "1e17" },
      { id: "bv_nd", label: "Nd", unit: "cm⁻³", width: 64, default: "1e17" },
      { id: "bv_ni", label: "nᵢ", unit: "cm⁻³", width: 64, default: "9.65e9" },
      { id: "bv_t", label: "T", unit: "K", width: 52, default: "300" },
    ],
    compute: async (n) => {
      const r = await semiconductorBuiltInPotential(n("bv_na"), n("bv_nd"), n("bv_ni"), n("bv_t"));
      return `V_bi = ${fmtNum(r.Vbi)} V`;
    },
  },
  {
    title: "Sheet carrier density",
    fields: [
      { id: "sc_n", label: "n", unit: "cm⁻³", width: 84, default: "1e17" },
      { id: "sc_t", label: "t", unit: "nm", width: 72, default: "10" },
    ],
    compute: async (n) => {
      const r = await semiconductorSheetCarrierDensity(n("sc_n"), n("sc_t") * NM_TO_CM);
      return `n_s = ${fmtNum(r.ns)} cm⁻²`;
    },
  },
  {
    title: "Thermal velocity",
    fields: [
      { id: "tv_m", label: "m*", width: 84, default: "0.26" },
      { id: "tv_t", label: "T", unit: "K", width: 72, default: "300" },
    ],
    compute: async (n) => {
      const r = await semiconductorThermalVelocity(n("tv_m"), n("tv_t"));
      return `v_th = ${fmtNum(r.vth)} cm/s`;
    },
  },
  {
    title: "Hall coefficient (mixed conduction)",
    fields: [
      { id: "hc_n", label: "n", unit: "cm⁻³", width: 64, default: "1e16" },
      { id: "hc_p", label: "p", unit: "cm⁻³", width: 64, default: "1e4" },
      { id: "hc_me", label: "μₑ", width: 56, default: "1400" },
      { id: "hc_mh", label: "μ_h", width: 56, default: "450" },
    ],
    compute: async (n) => {
      const r = await semiconductorHallCoefficient(n("hc_n"), n("hc_p"), n("hc_me"), n("hc_mh"));
      return `R_H = ${fmtNum(r.RH)} cm³/C · ${r.apparent_type}-type`;
    },
  },
  {
    title: "Mobility (Caughey-Thomas, Si)",
    fields: [
      { id: "mm_n", label: "N", unit: "cm⁻³", width: 84, default: "1e16" },
      { id: "mm_t", label: "T", unit: "K", width: 72, default: "300" },
    ],
    compute: async (n) => {
      const r = await semiconductorMobilityModel("Si", n("mm_t"), n("mm_n"));
      return `μₑ = ${fmtNum(r.muE)} · μ_h = ${fmtNum(r.muH)} cm²/V·s`;
    },
  },
];

const DEFAULTS: Vals = Object.fromEntries(
  CARDS.flatMap((c) => c.fields.map((f) => [f.id, f.default])),
);

export default function SemiconductorTab() {
  const [vals, setVals] = useState<Vals>(DEFAULTS);
  const [results, setResults] = useState<Record<number, CardResult>>({});

  const set = (id: string) => (v: string) => setVals((s) => ({ ...s, [id]: v }));
  const num = (id: string) => Number(vals[id]);

  function run(idx: number, card: CardSpec): Promise<void> {
    return runCard(
      (r) => setResults((s) => ({ ...s, [idx]: r })),
      card.title,
      () => card.compute(num),
    );
  }

  function pickMaterial(card: CardSpec, name: string): void {
    const m = MATERIALS[name];
    if (!m || !card.material) return;
    setVals((s) => {
      const next = { ...s };
      for (const f of card.material ?? []) next[f.to] = String(m[f.from]);
      return next;
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      {CARDS.map((card, idx) => (
        <Card key={card.title} title={card.title}>
          <div style={ROW}>
            {card.material && (
              <select
                className="qz-select"
                defaultValue=""
                aria-label={`${card.title} material preset`}
                onChange={(e) => e.target.value && pickMaterial(card, e.target.value)}
              >
                <option value="">(manual)</option>
                {MAT_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
            {card.fields.map((f) => (
              <Field
                key={f.id}
                label={f.label}
                value={vals[f.id]}
                onChange={set(f.id)}
                width={f.width}
                unit={f.unit}
              />
            ))}
            <Button variant="primary" size="sm" onClick={() => void run(idx, card)}>
              =
            </Button>
          </div>
          {resultLine(results[idx] ?? null)}
        </Card>
      ))}
    </div>
  );
}
