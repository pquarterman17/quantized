// Calculators ▸ Constants tab — CODATA physical constants (GET
// /api/reference/constants -> calc.constants_by_system). Self-contained: owns
// its fetch + system/search state locally (it needs nothing from
// useCalculators), per the "decouple a component from the store when it
// needn't be coupled" rule (mirrors ElementsTab).

import { useEffect, useState } from "react";

import { getConstants } from "../../../lib/api/reference";
import { fmtNum } from "../../../lib/format";
import type { ConstantEntry, ConstantSystem } from "../../../lib/types";
import { DataTable } from "../../primitives/DataTable";
import { Select } from "../../primitives";

const SYSTEM_OPTIONS: { value: ConstantSystem; label: string }[] = [
  { value: "SI", label: "SI" },
  { value: "CGS", label: "CGS (Gaussian)" },
  { value: "eV", label: "eV-based" },
];

export default function ConstantsTab() {
  const [systems, setSystems] = useState<Record<ConstantSystem, ConstantEntry[]> | null>(null);
  const [error, setError] = useState(false);
  const [system, setSystem] = useState<ConstantSystem>("SI");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getConstants()
      .then((r) => {
        if (!cancelled) setSystems(r.systems);
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
        Constants unavailable (backend offline).
      </div>
    );
  }
  if (!systems) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
        Loading…
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const entries = systems[system] ?? [];
  const matches =
    q === ""
      ? entries
      : entries.filter(
          (c) =>
            c.key.toLowerCase().includes(q) ||
            c.symbol.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q),
        );

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <Select
          options={SYSTEM_OPTIONS}
          value={system}
          onChange={(e) => setSystem(e.target.value as ConstantSystem)}
          aria-label="unit system"
          style={{ width: 160, flex: "0 0 auto" }}
        />
        <input
          className="qz-input"
          style={{ flex: 1 }}
          placeholder="search symbol / name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="constant search"
        />
      </div>
      <DataTable
        columns={["constant", "value"]}
        rows={matches.map((c) => [
          <span key={`${c.key}-label`}>
            <b style={{ fontFamily: "var(--font-mono)" }}>{c.symbol}</b>{" "}
            <span style={{ color: "var(--text-faint)" }}>{c.name}</span>
          </span>,
          <span key={`${c.key}-value`} style={{ fontFamily: "var(--font-mono)" }}>
            {fmtNum(c.value)} <span style={{ color: "var(--text-faint)" }}>{c.unit}</span>
          </span>,
        ])}
      />
      {matches.length === 0 && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          no match
        </div>
      )}
    </div>
  );
}
