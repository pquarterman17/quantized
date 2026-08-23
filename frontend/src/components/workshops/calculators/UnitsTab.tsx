// Calculators ▸ Units tab — category-driven unit-expression converter with
// quick-pick chips. Presentational; all state/logic is in the useCalculators
// hook (math is golden in calc.unit_convert). A category Select narrows the
// from/to pickers to a curated, mutually-convertible unit list fetched from
// /api/reference/unit-categories; the "Photon / Thermal Energy" category is
// special-cased to a 5-quantity readout (PhotonEnergyPanel) instead of a
// single from/to pair, since that's the useful presentation for it. Falls
// back to free-text from/to inputs if the category table hasn't loaded
// (offline / first paint), matching the tab's pre-category behavior.

import { NumberField } from "../../primitives/NumberField";
import { Pill } from "../../primitives/Pill";
import { Button, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import PhotonEnergyPanel from "./PhotonEnergyPanel";
import { CopyButton } from "./shared";
import { QUICK_PAIRS, type CalculatorsState } from "./useCalculators";

export default function UnitsTab({ c }: { c: CalculatorsState }) {
  const cats = c.unitCategories ?? [];
  const activeCat = cats.find((x) => x.id === c.category);
  const isPhotonEnergy = c.category === "photon_energy";

  return (
    <div style={{ marginTop: 12 }}>
      {cats.length > 0 && (
        <Select
          options={cats.map((x) => ({ value: x.id, label: x.label }))}
          value={c.category}
          onChange={(e) => c.setCategory(e.target.value)}
          aria-label="unit category"
          style={{ marginBottom: 10 }}
        />
      )}

      {isPhotonEnergy ? (
        <PhotonEnergyPanel c={c} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <NumberField value={c.value} width={84} onChange={c.setValue} />
            {activeCat ? (
              <Select
                options={activeCat.units}
                value={c.from}
                onChange={(e) => c.setFrom(e.target.value)}
                aria-label="from unit"
              />
            ) : (
              <input
                className="qz-input"
                style={{ width: 64 }}
                value={c.from}
                onChange={(e) => c.setFrom(e.target.value)}
                aria-label="from unit"
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label="swap units"
              title="swap from/to"
              onClick={c.swapUnits}
            >
              ⇄
            </Button>
            {activeCat ? (
              <Select
                options={activeCat.units}
                value={c.to}
                onChange={(e) => c.setTo(e.target.value)}
                aria-label="to unit"
              />
            ) : (
              <input
                className="qz-input"
                style={{ width: 64 }}
                value={c.to}
                onChange={(e) => c.setTo(e.target.value)}
                aria-label="to unit"
              />
            )}
            <Button variant="primary" size="sm" disabled={c.busy} onClick={() => void c.convert()}>
              =
            </Button>
          </div>

          {activeCat?.hint && (
            <div
              className="qzk-ds-meta"
              style={{ marginTop: 8, color: "var(--text-faint)", maxWidth: 420 }}
            >
              {activeCat.hint}
            </div>
          )}

          {c.result != null && !c.error && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
                {fmtNum(c.result)} <span style={{ color: "var(--text-dim)" }}>{c.to}</span>
                <CopyButton value={String(c.result)} label="converted value" />
              </div>
              {c.description && (
                <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
                  {c.description}
                </div>
              )}
            </div>
          )}
          {c.error && (
            <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
              {c.error}
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {QUICK_PAIRS.map((p) => (
          <Pill
            key={p.label}
            active={c.from === p.from && c.to === p.to && c.category === p.category}
            onClick={() => c.setPair(p.from, p.to, p.category)}
          >
            {p.label}
          </Pill>
        ))}
      </div>
    </div>
  );
}
