// Calculators ▸ X-ray tab — Bragg / Q-space / energy↔wavelength conversions
// (golden calc.xray) plus a neutron wavelength↔energy↔velocity↔temperature
// converter (calc.xray.neutron_calc — new, no MATLAB counterpart).
// Bragg/Q card is presentational (state in useCalculators, so Crystal's
// "→ X-ray" cross-panel hand-off keeps working); the Neutron card is
// self-contained, following the newer per-tab-owns-its-state convention.

import { useRef, useState } from "react";

import { NumberField } from "../../primitives/NumberField";
import { Pill } from "../../primitives/Pill";
import { Button, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { neutronCalc, xrayCalc } from "../../../lib/api";
import {
  ANODE_PRESETS,
  NEUTRON_WAVELENGTHS,
  XRAY_MODES,
  type CalculatorsState,
} from "./useCalculators";
import { Card, CopyButton, ROW, resultLine, useCard, withTouch } from "./shared";

const NEUTRON_QUANTITIES: { value: string; label: string; unit: string }[] = [
  { value: "wavelength", label: "λ — wavelength", unit: "Å" },
  { value: "energy", label: "E — energy", unit: "meV" },
  { value: "velocity", label: "v — velocity", unit: "m/s" },
  { value: "temperature", label: "T — temperature", unit: "K" },
];

export default function XrayTab({ c }: { c: CalculatorsState }) {
  // Energy(keV) → wavelength(Å) helper for the Bragg/Q card's λ field: a
  // small local scratch value, not part of the shared conversion state.
  // Review round 2: the helper carries the SAME provenance contract as the
  // cards — a monotonic request id; editing the energy disowns any pending
  // request (and re-arms the button), and a disowned completion writes
  // nothing: not the wavelength, not the error, not the busy flag.
  const [fromEnergy, setFromEnergy] = useState("8.0478"); // Cu Kα1 ≈ 8.0478 keV
  const [energyBusy, setEnergyBusy] = useState(false);
  const [energyError, setEnergyError] = useState<string | null>(null);
  const energySeq = useRef(0);
  const onFromEnergyChange = (v: string): void => {
    setFromEnergy(v);
    energySeq.current++; // a pending request now answers a question no longer asked
    setEnergyError(null);
    setEnergyBusy(false);
  };

  // Neutron card — self-contained local state.
  const [nQuantity, setNQuantity] = useState("wavelength");
  const [nValue, setNValue] = useState("1.8"); // Å, near-thermal
  const nCard = useCard("Neutron");

  const mode = XRAY_MODES.find((m) => m.value === c.xrayMode);
  const needsWavelength = mode?.needsWavelength !== false;

  async function applyEnergyAsWavelength(): Promise<void> {
    const id = ++energySeq.current;
    setEnergyBusy(true);
    setEnergyError(null);
    try {
      const e = Number(fromEnergy);
      if (!Number.isFinite(e)) throw new Error("enter a numeric energy");
      const r = await xrayCalc("wavelength_from_energy", 0, e);
      if (energySeq.current !== id) return; // superseded — the λ belongs to an OLD energy
      // DIRACULATOR_AUDIT P2: store the LOSSLESS value — fmtNum honors the
      // 1-12 sig-fig display preference, and a presentation setting must
      // never alter a chained scientific input (Bragg/Q downstream).
      c.setWavelength(String(r.result));
    } catch (err) {
      if (energySeq.current !== id) return;
      setEnergyError(err instanceof Error ? err.message : "conversion failed");
    } finally {
      if (energySeq.current === id) setEnergyBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Bragg / Q-space">
        <Select
          options={XRAY_MODES.map((m) => ({ value: m.value, label: m.label }))}
          value={c.xrayMode}
          onChange={(e) => c.setXrayMode(e.target.value)}
          aria-label="x-ray conversion"
        />

        {needsWavelength && (
          <>
            <div style={{ ...ROW, marginTop: 10 }}>
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                λ
              </span>
              <NumberField value={c.wavelength} width={84} onChange={c.setWavelength} />
              <span style={{ color: "var(--text-faint)" }}>Å</span>
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                n
              </span>
              <NumberField value={c.xrayOrder} width={44} onChange={c.setXrayOrder} />
            </div>
            <div style={{ ...ROW, marginTop: 8 }}>
              {ANODE_PRESETS.map((w) => (
                <Pill
                  key={w.label}
                  active={Number(c.wavelength) === w.a}
                  onClick={() => c.setWavelength(String(w.a))}
                >
                  {w.label}
                </Pill>
              ))}
            </div>
            <div style={{ ...ROW, marginTop: 8 }}>
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                or from E
              </span>
              <NumberField value={fromEnergy} width={72} onChange={onFromEnergyChange} />
              <span style={{ color: "var(--text-faint)" }}>keV</span>
              <Button variant="ghost" size="sm" disabled={energyBusy} onClick={() => void applyEnergyAsWavelength()}>
                → λ
              </Button>
            </div>
            {energyError && <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>{energyError}</div>}
          </>
        )}

        <div style={{ ...ROW, marginTop: 10 }}>
          <NumberField value={c.xrayValue} width={100} onChange={c.setXrayValue} />
          <span style={{ color: "var(--text-faint)" }}>{mode?.inUnit ?? ""}</span>
          <Button variant="primary" size="sm" disabled={c.xrayBusy} onClick={() => void c.xrayCompute()}>
            =
          </Button>
        </div>
        {c.xrayResult && !c.xrayError && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
              {fmtNum(c.xrayResult.result)}{" "}
              <span style={{ color: "var(--text-dim)" }}>{c.xrayResult.unit}</span>
              <CopyButton value={String(c.xrayResult.result)} label="result" />
            </div>
            <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
              {c.xrayResult.description}
            </div>
          </div>
        )}
        {c.xrayError && (
          <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
            {c.xrayError}
          </div>
        )}
      </Card>

      <Card title="Neutron: λ ↔ E ↔ v ↔ T">
        <Select
          options={NEUTRON_QUANTITIES.map((q) => ({ value: q.value, label: q.label }))}
          value={nQuantity}
          onChange={(e) => {
            setNQuantity(e.target.value);
            nCard.touch();
          }}
          aria-label="neutron input quantity"
        />
        <div style={{ ...ROW, marginTop: 8 }}>
          <NumberField value={nValue} width={100} onChange={withTouch(nCard.touch, setNValue)} />
          <span style={{ color: "var(--text-faint)" }}>
            {NEUTRON_QUANTITIES.find((q) => q.value === nQuantity)?.unit ?? ""}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void nCard.run(
                "Neutron conversion",
                `quantity=${nQuantity}, value=${nValue}`,
                async () => {
                const v = Number(nValue);
                if (!Number.isFinite(v)) throw new Error("enter a numeric value");
                const r = await neutronCalc(nQuantity, v);
                return (
                  `λ = ${fmtNum(r.wavelength_a)} Å · E = ${fmtNum(r.energy_mev)} meV · ` +
                  `v = ${fmtNum(r.velocity_m_s)} m/s · T = ${fmtNum(r.temperature_k)} K`
                );
                },
              )
            }
          >
            Convert
          </Button>
        </div>
        {nQuantity === "wavelength" && (
          <div style={{ ...ROW, marginTop: 8 }}>
            {NEUTRON_WAVELENGTHS.map((w) => (
              <Pill
                key={w.label}
                active={Number(nValue) === w.a}
                onClick={() => {
                  setNValue(String(w.a));
                  nCard.touch();
                }}
              >
                {w.label}
              </Pill>
            ))}
          </div>
        )}
        {resultLine(nCard.result)}
      </Card>
    </div>
  );
}
