// Calculators ▸ Crystal tab — interplanar d-spacing (all 7 systems) + unit-cell
// volume & theoretical density (calc.crystallography + calc.formula).
// Presentational; state in useCalculators. Hexagonal additionally offers the
// 4-index Miller-Bravais (hkil) plane notation alongside the ordinary 3-index
// (hkl) form — see calc.crystallography.hkl_to_hkil for the i = -(h+k) rule.

import { useState } from "react";

import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { crystalInterplanarAngle } from "../../../lib/api/crystallography";
import { Card, CopyButton, ROW, resultLine, useCard, withTouch } from "./shared";
import { assembleCell, CRYSTAL_SYSTEMS, type CalculatorsState, type CellAngle } from "./useCalculators";

const ANGLE_GLYPH: Record<CellAngle, string> = { alpha: "α", beta: "β", gamma: "γ" };

/** Space-separated Miller notation, e.g. "1 1 -2 0" (ASCII, unambiguous with
 *  negative indices — never a bare "1 1-2 0"). */
function fmtMiller(indices: number[]): string {
  return indices.map((n) => (Number.isFinite(n) ? String(n) : "?")).join(" ");
}

export default function CrystalTab({ c }: { c: CalculatorsState }) {
  const spec = CRYSTAL_SYSTEMS.find((s) => s.value === c.crystal.system);
  const lengths = spec?.lengths ?? [];
  const angles = spec?.angles ?? [];
  const isHex = c.crystal.system === "hexagonal";
  const [millerMode, setMillerMode] = useState<"3" | "4">("3");
  // Interplanar-angle card — same crystal system/lattice as above; two plane
  // index sets are its own local state.
  const [ah1, setAh1] = useState("1");
  const [ak1, setAk1] = useState("0");
  const [al1, setAl1] = useState("0");
  const [ah2, setAh2] = useState("1");
  const [ak2, setAk2] = useState("1");
  const [al2, setAl2] = useState("0");
  const angleCard = useCard("Crystal");
  const show4Index = isHex && millerMode === "4";
  const hNum = Number(c.crystal.h);
  const kNum = Number(c.crystal.k);
  const lNum = Number(c.crystal.l);
  // i = -(h+k): the Miller-Bravais closure rule (calc.crystallography.hkl_to_hkil).
  // Always shown derived from h, k as the user types — never independently editable.
  const derivedI = -(hNum + kNum);
  return (
    <div style={{ marginTop: 12 }}>
      <Select
        options={CRYSTAL_SYSTEMS.map((s) => ({ value: s.value, label: s.label }))}
        value={c.crystal.system}
        onChange={(e) => c.updCrystal({ system: e.target.value })}
        aria-label="crystal system"
      />

      {/* Lattice lengths (a always; b/c per system) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          a
        </span>
        <NumberField value={c.crystal.a} width={64} onChange={(v) => c.updCrystal({ a: v })} />
        {lengths.includes("b") && (
          <>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              b
            </span>
            <NumberField value={c.crystal.b} width={64} onChange={(v) => c.updCrystal({ b: v })} />
          </>
        )}
        {lengths.includes("c") && (
          <>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              c
            </span>
            <NumberField value={c.crystal.c} width={64} onChange={(v) => c.updCrystal({ c: v })} />
          </>
        )}
        <span style={{ color: "var(--text-faint)" }}>Å</span>
      </div>

      {/* Lattice angles (only for low-symmetry systems) */}
      {angles.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {angles.map((ang) => (
            <span key={ang} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                {ANGLE_GLYPH[ang]}
              </span>
              <NumberField
                value={c.crystal[ang]}
                width={64}
                onChange={(v) => c.updCrystal({ [ang]: v })}
              />
            </span>
          ))}
          <span style={{ color: "var(--text-faint)" }}>°</span>
        </div>
      )}

      {/* d-spacing from Miller indices */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          {show4Index ? "hkil" : "hkl"}
        </span>
        <NumberField
          value={c.crystal.h}
          width={44}
          onChange={(v) => c.updCrystal({ h: v })}
          aria-label="h"
        />
        <NumberField
          value={c.crystal.k}
          width={44}
          onChange={(v) => c.updCrystal({ k: v })}
          aria-label="k"
        />
        {show4Index && (
          <NumberField
            value={Number.isFinite(derivedI) ? derivedI : ""}
            width={44}
            disabled
            aria-label="i (derived)"
            title="derived: i = -(h+k), not editable"
          />
        )}
        <NumberField
          value={c.crystal.l}
          width={44}
          onChange={(v) => c.updCrystal({ l: v })}
          aria-label="l"
        />
        {isHex && (
          <SegmentedControl<"3" | "4">
            options={[
              { value: "3", label: "3-idx" },
              { value: "4", label: "4-idx" },
            ]}
            value={millerMode}
            onChange={setMillerMode}
          />
        )}
        <Button variant="primary" size="sm" disabled={c.crBusy} onClick={() => void c.crCompute()}>
          =
        </Button>
      </div>
      {c.crResult && !c.crError && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
            d = {fmtNum(c.crResult.d)} <span style={{ color: "var(--text-dim)" }}>Å</span>
            <CopyButton value={String(c.crResult.d)} label="d-spacing" />
          </span>
          {isHex && (
            <span className="qzk-ds-meta" style={{ fontFamily: "var(--font-mono)" }}>
              (hkl) {fmtMiller([hNum, kNum, lNum])} = (hkil) {fmtMiller([hNum, kNum, derivedI, lNum])}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={c.sendDToXray}
            title="Use this d in the X-ray tab (d → 2θ → Q)"
          >
            → X-ray
          </Button>
        </div>
      )}
      {c.crError && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {c.crError}
        </div>
      )}

      {/* Cell volume + theoretical density (shares the lattice above) */}
      <div className="qzk-field-lbl" style={{ marginTop: 16 }}>
        Cell volume &amp; density
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          formula
        </span>
        <NumberField
          numeric={false}
          value={c.crystal.formula}
          width={92}
          onChange={(v) => c.updCrystal({ formula: v })}
          aria-label="chemical formula"
        />
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          Z
        </span>
        <NumberField value={c.crystal.z} width={44} onChange={(v) => c.updCrystal({ z: v })} />
        <Button variant="primary" size="sm" disabled={c.cellBusy} onClick={() => void c.cellCompute()}>
          =
        </Button>
      </div>
      {c.cellResult && !c.cellError && (
        <div style={{ marginTop: 10, fontFamily: "var(--font-mono)" }}>
          <div style={{ fontSize: "var(--font-size-lg)" }}>
            V = {fmtNum(c.cellResult.volume)} <span style={{ color: "var(--text-dim)" }}>Å³</span>
            <CopyButton value={String(c.cellResult.volume)} label="cell volume" />
          </div>
          {c.cellResult.density != null && (
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-dim)" }}>
                ρ = {fmtNum(c.cellResult.density)} g/cm³
                {c.cellResult.molar_mass != null && (
                  <> · M = {fmtNum(c.cellResult.molar_mass)} g/mol</>
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={c.sendCellToSld}
                title="Use this formula + theoretical density in the SLD tab"
              >
                → SLD
              </Button>
            </div>
          )}
        </div>
      )}
      {c.cellError && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {c.cellError}
        </div>
      )}

      {/* Interplanar angle — reuses the system + lattice above; two plane index sets */}
      <Card title="Interplanar angle">
        <div style={ROW}>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>
            hkl₁
          </span>
          <NumberField value={ah1} width={40} onChange={withTouch(angleCard.touch, setAh1)} aria-label="h1" />
          <NumberField value={ak1} width={40} onChange={withTouch(angleCard.touch, setAk1)} aria-label="k1" />
          <NumberField value={al1} width={40} onChange={withTouch(angleCard.touch, setAl1)} aria-label="l1" />
          <span className="qzk-field-lbl" style={{ margin: 0 }}>
            hkl₂
          </span>
          <NumberField value={ah2} width={40} onChange={withTouch(angleCard.touch, setAh2)} aria-label="h2" />
          <NumberField value={ak2} width={40} onChange={withTouch(angleCard.touch, setAk2)} aria-label="k2" />
          <NumberField value={al2} width={40} onChange={withTouch(angleCard.touch, setAl2)} aria-label="l2" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void angleCard.run("Interplanar angle", async () => {
                const cell = assembleCell(c.crystal);
                const h1v = Number(ah1);
                const k1v = Number(ak1);
                const l1v = Number(al1);
                const h2v = Number(ah2);
                const k2v = Number(ak2);
                const l2v = Number(al2);
                if ([h1v, k1v, l1v, h2v, k2v, l2v].some((v) => !Number.isFinite(v))) {
                  throw new Error("enter numeric Miller indices for both planes");
                }
                const r = await crystalInterplanarAngle({
                  system: c.crystal.system,
                  ...cell,
                  h1: h1v,
                  k1: k1v,
                  l1: l1v,
                  h2: h2v,
                  k2: k2v,
                  l2: l2v,
                });
                return `φ = ${fmtNum(r.angle_deg)}°  (d₁ = ${fmtNum(r.d1)} Å, d₂ = ${fmtNum(r.d2)} Å)`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(angleCard.result)}
      </Card>
    </div>
  );
}
