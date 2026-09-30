// Calculators ▸ Magnetic ▸ Demagnetization factors — the "Custom geometry"
// inputs, loaded lazily by MagneticTab only when that option is picked.
// calc.magnetic.demag_factor takes dimensions, not N: a cylinder's length and
// diameter (Sato–Ishii), or a spheroid's axis ratio (exact Osborn formulas).
// Runs through the owning card, so the result line and history stay MagneticTab's.

import { useState } from "react";

import { magneticDemagCustom } from "../../../lib/api/magnetic";
import { Button, dual, Field, ROW, withTouch, type useCard } from "./shared";

type Geometry = "cylinder" | "prolate" | "oblate";

const GEOMETRIES: { value: Geometry; label: string; title: string }[] = [
  { value: "cylinder", label: "Cylinder (L, d)", title: "Sato–Ishii fit, valid for L/d from 0.1 to 10." },
  { value: "prolate", label: "Prolate spheroid (c/a)", title: "A rod along its long axis; c/a above 1." },
  { value: "oblate", label: "Oblate spheroid (a/c)", title: "A disk along its short axis; a/c above 1." },
];

export default function DemagCustomFields({ card }: { card: ReturnType<typeof useCard> }) {
  const [geometry, setGeometry] = useState<Geometry>("cylinder");
  const [length, setLength] = useState("2");
  const [diameter, setDiameter] = useState("1");
  const [ratio, setRatio] = useState("2");
  const spec = GEOMETRIES.find((g) => g.value === geometry) ?? GEOMETRIES[0];

  const calculate = () => {
    const body =
      geometry === "cylinder"
        ? { shape: geometry, length: Number(length), diameter: Number(diameter) }
        : { shape: geometry, ratio: Number(ratio) };
    const inputs =
      geometry === "cylinder" ? `shape=cylinder, L=${length}, d=${diameter}` : `shape=${geometry}, ratio=${ratio}`;
    void card.run("Demagnetization factors", inputs, async () => {
      const r = await magneticDemagCustom(body);
      return dual`Nz = ${r.Nz} · Nxy = ${r.Nxy} · 4πNz = ${r.n_cgs}`;
    });
  };

  return (
    <div style={{ ...ROW, flexWrap: "wrap" }}>
      <select
        className="qz-select"
        value={geometry}
        title={spec.title}
        onChange={(e) => {
          setGeometry(e.target.value as Geometry);
          card.touch();
        }}
        aria-label="custom geometry"
      >
        {GEOMETRIES.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </select>
      {geometry === "cylinder" ? (
        <>
          <Field label="L" ariaLabel="cylinder length" value={length} onChange={withTouch(card.touch, setLength)} width={56} />
          <Field label="d" ariaLabel="cylinder diameter" value={diameter} onChange={withTouch(card.touch, setDiameter)} width={56} />
        </>
      ) : (
        <Field
          label={geometry === "prolate" ? "c/a" : "a/c"}
          ariaLabel="axis ratio"
          value={ratio}
          onChange={withTouch(card.touch, setRatio)}
          width={56}
        />
      )}
      <Button variant="primary" size="sm" onClick={calculate}>
        Calculate
      </Button>
    </div>
  );
}
