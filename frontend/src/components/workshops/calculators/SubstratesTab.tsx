// Calculators ▸ Substrates tab — a reference table over the built-in substrate
// database (GET /api/substrates), plus the epitaxial lattice-mismatch formula
// f = (a_film - a_sub)/a_sub (POST /api/substrates/mismatch). Ports MATLAB
// DiraCulator buildSubstratesTab + calc.substrates. Self-contained: owns its
// fetch + selection state locally (nothing from useCalculators), mirroring
// ElementsTab.

import { useEffect, useState } from "react";

import {
  getSubstrates,
  substrateMismatch,
  substratesCriticalThickness,
  type SubstrateInfo,
} from "../../../lib/api/substrates";
import { fmtNum } from "../../../lib/format";
import { Card, resultLine, useCard } from "./shared";

// Detail rows: [label, key, unit]. Lattice rows are skipped for amorphous.
const LATTICE_FIELDS: [string, keyof SubstrateInfo, string][] = [
  ["a", "a", "Å"],
  ["b", "b", "Å"],
  ["c", "c", "Å"],
  ["α", "alpha", "°"],
  ["β", "beta", "°"],
  ["γ", "gamma", "°"],
];
const SCALAR_FIELDS: [string, keyof SubstrateInfo, string][] = [
  ["Density", "density", "g/cm³"],
  ["CTE", "thermalExpansion", "10⁻⁶/K"],
  ["ε_r", "dielectric", ""],
];

export default function SubstratesTab() {
  const [subs, setSubs] = useState<SubstrateInfo[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SubstrateInfo | null>(null);

  // Lattice-mismatch mini-calculator (substrate a_sub = selected.a).
  const [aFilm, setAFilm] = useState("3.876");
  const mm = useCard("Substrates");

  // MATLAB criticalThickness derives mismatch and b from a_film/a_sub.
  const [mbNu, setMbNu] = useState("0.3");
  const mb = useCard("Substrates");

  useEffect(() => {
    let cancelled = false;
    getSubstrates()
      .then((r) => {
        if (!cancelled) setSubs(r.substrates);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        Substrate data unavailable (backend offline).
      </div>
    );
  }
  if (!subs) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        Loading…
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches =
    q === ""
      ? subs
      : subs.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.formula.toLowerCase().includes(q),
        );

  async function runMismatch(): Promise<void> {
    if (!selected || selected.a == null) {
      mm.setResult({ text: `${selected?.name ?? "substrate"} has no lattice parameter`, err: true });
      return;
    }
    const af = Number(aFilm);
    if (!Number.isFinite(af) || af <= 0) {
      mm.setResult({ text: "a_film must be a positive number", err: true });
      return;
    }
    await mm.run(
      `Lattice mismatch vs ${selected.name}`,
      `a_film=${aFilm} Å, substrate=${selected.name}, a_sub=${selected.a} Å`,
      async () => {
        const r = await substrateMismatch(af, selected.a as number);
        return `f = ${fmtNum(r.mismatchPct)} %  (${r.description})`;
      },
    );
  }

  async function runCriticalThickness(): Promise<void> {
    if (!selected || selected.a == null) return;
    const af = Number(aFilm);
    const nu = Number(mbNu);
    if (!Number.isFinite(af) || af <= 0) {
      mb.setResult({ text: "a_film must be a positive number", err: true });
      return;
    }
    await mb.run(
      "Matthews-Blakeslee critical thickness",
      `a_film=${aFilm} Å, a_sub=${selected.a} Å, ν=${mbNu}`,
      async () => {
        const r = await substratesCriticalThickness(af, selected.a as number, nu);
        if (r.matched) return "h_c = ∞ (lattice matched)";
        return `h_c = ${fmtNum(r.h_c as number)} Å = ${fmtNum(r.h_c_nm as number)} nm`;
      },
    );
  }

  const isAmorphous = selected?.latticeType === "amorphous";

  return (
    <div style={{ marginTop: 12 }}>
      <input
        className="qz-input"
        style={{ width: "100%" }}
        placeholder="search name / formula"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="substrate search"
      />
      <div style={{ maxHeight: 150, overflowY: "auto", marginTop: 8 }}>
        {matches.map((s) => (
          <button
            key={s.name}
            className={selected?.name === s.name ? "qz-btn qz-active" : "qz-btn"}
            style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 2 }}
            onClick={() => {
              setSelected(s);
              mm.touch(); // a_sub changed — any shown mismatch is stale
              mb.touch();
            }}
          >
            <span>
              <b style={{ fontFamily: "var(--font-mono)" }}>{s.name}</b>
            </span>
            <span style={{ color: "var(--text-faint)" }}>{s.formula}</span>
          </button>
        ))}
        {matches.length === 0 && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            no match
          </div>
        )}
      </div>

      {selected && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
            {selected.formula} — {selected.orientation}
          </div>
          <div className="qz-meta-row">
            <span className="qz-k">Lattice type</span>
            <span className="qz-v">{selected.latticeType}</span>
          </div>
          {!isAmorphous &&
            LATTICE_FIELDS.map(([label, key, unit]) => {
              const v = selected[key];
              if (v == null) return null;
              return (
                <div key={key} className="qz-meta-row">
                  <span className="qz-k">{label}</span>
                  <span className="qz-v">
                    {fmtNum(v as number)}
                    {unit ? ` ${unit}` : ""}
                  </span>
                </div>
              );
            })}
          {SCALAR_FIELDS.map(([label, key, unit]) => (
            <div key={key} className="qz-meta-row">
              <span className="qz-k">{label}</span>
              <span className="qz-v">
                {fmtNum(selected[key] as number)}
                {unit ? ` ${unit}` : ""}
              </span>
            </div>
          ))}

          {!isAmorphous && (
            <Card title={`Lattice mismatch vs ${selected.name}`}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="qzk-field-lbl" style={{ margin: 0 }}>
                  a_film
                </span>
                <input
                  className="qz-input"
                  style={{ width: 90 }}
                  value={aFilm}
                  onChange={(e) => {
                    setAFilm(e.target.value);
                    mm.touch();
                    mb.touch();
                  }}
                  aria-label="a_film"
                />
                <span className="qzk-field-lbl" style={{ margin: 0 }}>
                  Å
                </span>
                <button className="qz-btn" onClick={runMismatch}>
                  Mismatch
                </button>
              </span>
              {resultLine(mm.result)}
            </Card>
          )}

          {!isAmorphous && (
            <Card title="Matthews-Blakeslee critical thickness">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span className="qzk-field-lbl" style={{ margin: 0 }}>
                  b = a_film/√2
                </span>
                <span className="qzk-field-lbl" style={{ margin: 0 }}>
                  ν
                </span>
                <input
                  className="qz-input"
                  style={{ width: 48 }}
                  value={mbNu}
                  onChange={(e) => {
                    setMbNu(e.target.value);
                    mb.touch();
                  }}
                  aria-label="Poisson ratio"
                />
                <button className="qz-btn" onClick={() => void runCriticalThickness()}>
                  Calculate
                </button>
              </span>
              {resultLine(mb.result)}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
