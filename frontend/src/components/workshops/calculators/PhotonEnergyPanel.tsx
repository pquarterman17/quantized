// Calculators ▸ Units ▸ Photon/Thermal Energy — the 5 interchangeable
// quantities (eV, nm, cm-1, THz, K) shown side by side for ONE entered value,
// rather than a single from/to pair. Extracted from UnitsTab to keep it under
// the component-size convention. Presentational; math via useCalculators'
// peCompute (calc.unit_convert, routed through a common energy hub).

import { Button, DataTable, NumberField, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { CopyButton } from "./shared";
import type { CalculatorsState } from "./useCalculators";

const PHOTON_ENERGY_FALLBACK = [
  { value: "eV", label: "eV" },
  { value: "nm", label: "nm (wavelength)" },
  { value: "cm^-1", label: "cm-1 (wavenumber)" },
  { value: "THz", label: "THz" },
  { value: "K", label: "K (E / kB)" },
];

export default function PhotonEnergyPanel({ c }: { c: CalculatorsState }) {
  const cat = c.unitCategories?.find((x) => x.id === "photon_energy");
  const units = cat?.units ?? PHOTON_ENERGY_FALLBACK;
  const labelOf = (v: string): string => units.find((u) => u.value === v)?.label ?? v;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <NumberField value={c.peValue} width={84} onChange={c.setPeValue} />
        <Select
          options={units}
          value={c.peFrom}
          onChange={(e) => c.setPeFrom(e.target.value)}
          aria-label="photon-energy quantity"
        />
        <Button variant="primary" size="sm" disabled={c.peBusy} onClick={() => void c.peCompute()}>
          =
        </Button>
      </div>

      {cat?.hint && (
        <div
          className="qzk-ds-meta"
          style={{ marginTop: 8, color: "var(--text-faint)", maxWidth: 420 }}
        >
          {cat.hint}
        </div>
      )}

      {c.peResults && !c.peError && (
        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={["Quantity", "Value"]}
            rows={units.map((u) => [
              labelOf(u.value),
              <span
                key={u.value}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: u.value === c.peFrom ? 700 : 400,
                }}
              >
                {fmtNum(c.peResults?.[u.value] ?? null)}
              </span>,
            ])}
          />
          <CopyButton
            value={units.map((u) => `${u.value}\t${c.peResults?.[u.value] ?? ""}`).join("\n")}
            label="all quantities"
          />
        </div>
      )}
      {c.peError && (
        <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
          {c.peError}
        </div>
      )}
    </div>
  );
}
