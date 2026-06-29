// Calculators ▸ Substrates tab — a reference table over the built-in substrate
// database (GET /api/substrates), plus the epitaxial lattice-mismatch formula
// f = (a_film - a_sub)/a_sub (POST /api/substrates/mismatch). Ports MATLAB
// DiraCulator buildSubstratesTab + calc.substrates. Self-contained: owns its
// fetch + selection state locally (nothing from useCalculators), mirroring
// ElementsTab.

import { useEffect, useState } from "react";

import { getSubstrates, substrateMismatch } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

const DOMAIN = "Substrates";

/** One substrate row from the reference table (mirrors calc.substrates dict). */
export interface SubstrateInfo {
  name: string;
  formula: string;
  orientation: string;
  a: number | null;
  b: number | null;
  c: number | null;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  thermalExpansion: number;
  dielectric: number;
  density: number;
  latticeType: string;
}

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

const RESULT: React.CSSProperties = {
  marginTop: 8,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-lg)",
};
const ERR: React.CSSProperties = { marginTop: 8, color: "var(--danger)" };

export default function SubstratesTab() {
  const [subs, setSubs] = useState<SubstrateInfo[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SubstrateInfo | null>(null);

  // Lattice-mismatch mini-calculator (substrate a_sub = selected.a).
  const [aFilm, setAFilm] = useState("3.876");
  const [mm, setMm] = useState<{ text: string; err?: boolean } | null>(null);

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

  async function runMismatch() {
    if (!selected || selected.a == null) {
      setMm({ text: `${selected?.name ?? "substrate"} has no lattice parameter`, err: true });
      return;
    }
    const af = Number(aFilm);
    if (!Number.isFinite(af) || af <= 0) {
      setMm({ text: "a_film must be a positive number", err: true });
      return;
    }
    try {
      const r = await substrateMismatch(af, selected.a);
      const text = `f = ${fmtNum(r.mismatchPct)} %  (${r.description})`;
      setMm({ text });
      useCalcHistory.getState().record({
        domain: DOMAIN,
        label: `Lattice mismatch vs ${selected.name}`,
        summary: text,
      });
    } catch {
      setMm({ text: "calculation failed", err: true });
    }
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
              setMm(null);
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
            <div
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 6,
                padding: "8px 10px",
                marginTop: 10,
              }}
            >
              <div className="qzk-field-lbl" style={{ marginTop: 0, marginBottom: 6 }}>
                Lattice mismatch vs {selected.name}
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="qzk-field-lbl" style={{ margin: 0 }}>
                  a_film
                </span>
                <input
                  className="qz-input"
                  style={{ width: 90 }}
                  value={aFilm}
                  onChange={(e) => setAFilm(e.target.value)}
                  aria-label="a_film"
                />
                <span className="qzk-field-lbl" style={{ margin: 0 }}>
                  Å
                </span>
                <button className="qz-btn" onClick={runMismatch}>
                  Mismatch
                </button>
              </span>
              {mm && <div style={mm.err ? ERR : RESULT}>{mm.text}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
