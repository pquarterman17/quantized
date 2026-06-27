// Calculators ▸ Elements tab — a periodic-table reference over the golden
// element_data table (GET /api/reference/elements). Self-contained: owns its
// fetch + search/selection state locally (it needs nothing from useCalculators),
// per the "decouple a component from the store when it needn't be coupled" rule.

import { useEffect, useState } from "react";

import { getElements } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import type { ElementInfo } from "../../../lib/types";

const MAX_ROWS = 30;

// Detail rows shown for a selected element: [label, data key, unit].
const DETAIL_FIELDS: [string, string, string][] = [
  ["Atomic mass", "mass", "u"],
  ["Category", "category", ""],
  ["Group", "group", ""],
  ["Period", "period", ""],
  ["Config", "electronConfig", ""],
  ["Density", "density", "g/cm³"],
  ["Electronegativity", "electronegativity", ""],
  ["Melting pt", "meltingPoint", "K"],
  ["Boiling pt", "boilingPoint", "K"],
  ["Neutron b_coh", "bCoherent", "fm"],
];

export default function ElementsTab() {
  const [elements, setElements] = useState<ElementInfo[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ElementInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    getElements()
      .then((r) => {
        if (!cancelled) setElements(r.elements);
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
        Element data unavailable (backend offline).
      </div>
    );
  }
  if (!elements) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        Loading…
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches =
    q === ""
      ? elements
      : elements.filter(
          (el) =>
            el.symbol.toLowerCase().startsWith(q) ||
            el.name.toLowerCase().includes(q) ||
            String(el.Z) === q,
        );

  return (
    <div style={{ marginTop: 12 }}>
      <input
        className="qz-input"
        style={{ width: "100%" }}
        placeholder="search symbol / name / Z"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="element search"
      />
      <div style={{ maxHeight: 150, overflowY: "auto", marginTop: 8 }}>
        {matches.slice(0, MAX_ROWS).map((el) => (
          <button
            key={el.Z}
            className={selected?.Z === el.Z ? "qz-btn qz-active" : "qz-btn"}
            style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 2 }}
            onClick={() => setSelected(el)}
          >
            <span>
              <b style={{ fontFamily: "var(--font-mono)" }}>{el.symbol}</b> {el.name}
            </span>
            <span style={{ color: "var(--text-faint)" }}>Z={el.Z}</span>
          </button>
        ))}
        {matches.length === 0 && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            no match
          </div>
        )}
        {matches.length > MAX_ROWS && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            showing {MAX_ROWS} of {matches.length} — refine the search
          </div>
        )}
      </div>
      {selected && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
            {selected.symbol} — {selected.name}
          </div>
          {DETAIL_FIELDS.map(([label, key, unit]) => {
            const v = selected[key];
            if (v == null) return null;
            const text = typeof v === "number" ? fmtNum(v) : String(v);
            return (
              <div key={key} className="qz-meta-row">
                <span className="qz-k">{label}</span>
                <span className="qz-v">
                  {text}
                  {unit ? ` ${unit}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
