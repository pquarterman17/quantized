// Calculators ▸ Crystal tab — Plane Spacing Table (MATLAB DiraCulator
// buildCrystalTab Card 5, calc.crystal.planeSpacings → the golden
// calc.plane_spacings). Lists every allowed (hkl) up to Max hkl for the tab's
// shared lattice, with d, 2θ and multiplicity.
//
// `card` is owned by CrystalTab — the same `useCard` instance its
// `updateLattice()` touch path invalidates — so a lattice edit clears the
// table exactly as it clears the interplanar- and bond-angle results. The
// rows are shown only while `card.result` is a success; they are written only
// by a completion that is still current.

import { useState } from "react";

import { crystalPlaneSpacings } from "../../../lib/api/crystallography";
import { Select } from "../../primitives";
import { Button, Card, Field, ROW, fmtNum, resultLine, useCard, withTouch } from "./shared";
import { assembleCell, type CrystalForm } from "./useCalculators";

type PlaneSpacingCardApi = ReturnType<typeof useCard>;

const CENTERINGS = [
  { value: "P", label: "P — primitive" },
  { value: "F", label: "F — face-centred" },
  { value: "I", label: "I — body-centred" },
  { value: "A", label: "A — A-face" },
  { value: "B", label: "B — B-face" },
  { value: "C", label: "C — C-face" },
  { value: "R", label: "R — rhombohedral (hex axes)" },
];

interface Row {
  hkl: [number, number, number];
  d: number;
  twoTheta: number | null;
  mult: number;
}

/** Tab-separated copy of the table, in MATLAB's "Copy Table" column layout
 *  ("-" for an unreachable reflection). Values keep full precision — the
 *  calculator copy contract never rounds what it hands on. */
function tableTsv(rows: Row[]): string {
  const lines = ["h\tk\tl\td(Å)\t2θ(°)\tMult"];
  for (const r of rows) {
    const tt = r.twoTheta == null ? "-" : String(r.twoTheta);
    lines.push(`${r.hkl.join("\t")}\t${String(r.d)}\t${tt}\t${r.mult}`);
  }
  return lines.join("\n");
}

export default function PlaneSpacingTableCard({
  crystal,
  card,
}: {
  crystal: CrystalForm;
  card: PlaneSpacingCardApi;
}) {
  const [centering, setCentering] = useState("P");
  const [maxHkl, setMaxHkl] = useState("5");
  const [wavelength, setWavelength] = useState("1.5406");
  const [rows, setRows] = useState<Row[]>([]);
  const { result, run, touch } = card;

  const generate = (): void => {
    void run(
      "Plane spacing table",
      `cell=${JSON.stringify(crystal)}, centering=${centering}, max_hkl=${maxHkl}, λ=${wavelength} Å`,
      async (isCurrent) => {
        const r = await crystalPlaneSpacings({
          ...assembleCell(crystal),
          centering,
          max_hkl: Number(maxHkl),
          wavelength: Number(wavelength),
        });
        const next = r.hkl.map((hkl, i) => ({
          hkl,
          d: r.d[i],
          twoTheta: r.two_theta[i],
          mult: r.multiplicity[i],
        }));
        if (isCurrent()) setRows(next);
        // The copy button carries the whole table, not just the summary line.
        const text = `${r.n_reflections} reflections [${r.system}, ${r.centering} centering]`;
        return { text, copyValue: tableTsv(next) };
      },
    );
  };

  const showTable = result != null && !("err" in result) && rows.length > 0;
  return (
    <Card title="Plane spacing table">
      <div style={ROW}>
        <Select
          aria-label="Bravais centering"
          value={centering}
          options={CENTERINGS}
          onChange={(event) => {
            setCentering(event.target.value);
            touch();
          }}
        />
        <Field label="max hkl" value={maxHkl} onChange={withTouch(touch, setMaxHkl)} width={44} />
        <Field label="λ" ariaLabel="wavelength" value={wavelength} onChange={withTouch(touch, setWavelength)} unit="Å" width={72} />
        <Button variant="primary" size="sm" onClick={generate}>
          Generate
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Uses the lattice above. Max hkl is 1–10; 2θ shows “–” when λ/2d &gt; 1.
      </div>
      {resultLine(result)}
      {showTable && (
        <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 6 }}>
          <table className="qz-table" aria-label="plane spacing table">
            <thead>
              <tr>
                <th>h</th>
                <th>k</th>
                <th>l</th>
                <th>d (Å)</th>
                <th>2θ (°)</th>
                <th>Mult</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.hkl.join(",")}>
                  <td>{r.hkl[0]}</td>
                  <td>{r.hkl[1]}</td>
                  <td>{r.hkl[2]}</td>
                  <td>{fmtNum(r.d)}</td>
                  <td>{r.twoTheta == null ? "–" : fmtNum(r.twoTheta)}</td>
                  <td>{r.mult}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
