import { useEffect, useRef, useState } from "react";

import { crystalBondAngle } from "../../../lib/api/crystallography";
import { Select } from "../../primitives";
import { Card, Field, ROW, Button, dual, resultLine, useCard, withTouch } from "./shared";
import { assembleCell, type CrystalForm } from "./useCalculators";

type FractionalCoordinate = [number, number, number];

function parseCoordinate(value: string, label: string): FractionalCoordinate {
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${label} must contain exactly three numeric fractional coordinates`);
  }
  return parts as FractionalCoordinate;
}

function latticeSignature(crystal: CrystalForm): string {
  return JSON.stringify([
    crystal.system,
    crystal.a,
    crystal.b,
    crystal.c,
    crystal.alpha,
    crystal.beta,
    crystal.gamma,
  ]);
}

export default function BondAngleCard({ crystal }: { crystal: CrystalForm }) {
  const [atom1, setAtom1] = useState("0.25 0 0");
  const [vertex, setVertex] = useState("0 0 0");
  const [atom3, setAtom3] = useState("0 0.25 0");
  const [imageMode, setImageMode] = useState<"nearest" | "entered">("nearest");
  const { result, run, touch } = useCard("Crystal");
  const signature = latticeSignature(crystal);
  const previousSignature = useRef(signature);

  useEffect(() => {
    if (previousSignature.current !== signature) {
      previousSignature.current = signature;
      touch();
    }
  }, [signature, touch]);

  const compute = (): void => {
    void run(
      "Atomic bond angle",
      `cell=${JSON.stringify(crystal)}, atom1=${atom1}, vertex=${vertex}, atom3=${atom3}, images=${imageMode}`,
      async () => {
        const response = await crystalBondAngle({
          ...assembleCell(crystal),
          atom1: parseCoordinate(atom1, "Neighbor 1"),
          vertex: parseCoordinate(vertex, "Vertex"),
          atom3: parseCoordinate(atom3, "Neighbor 2"),
          minimum_image: imageMode === "nearest",
        });
        const image1 = response.image1.join(" ");
        const image3 = response.image3.join(" ");
        return dual`θ = ${response.angle_deg}° · r₁ = ${response.distance1} Å · r₂ = ${response.distance3} Å · images (${image1}), (${image3})`;
      },
    );
  };

  return (
    <Card title="Atomic bond angle">
      <div style={ROW}>
        <Field
          label="Neighbor 1"
          ariaLabel="neighbor 1 fractional coordinates"
          value={atom1}
          width={112}
          numeric={false}
          onChange={withTouch(touch, setAtom1)}
        />
        <Field
          label="Vertex"
          ariaLabel="vertex fractional coordinates"
          value={vertex}
          width={112}
          numeric={false}
          onChange={withTouch(touch, setVertex)}
        />
        <Field
          label="Neighbor 2"
          ariaLabel="neighbor 2 fractional coordinates"
          value={atom3}
          width={112}
          numeric={false}
          onChange={withTouch(touch, setAtom3)}
        />
        <Select
          aria-label="periodic image handling"
          value={imageMode}
          options={[
            { value: "nearest", label: "Nearest periodic images" },
            { value: "entered", label: "Coordinates as entered" },
          ]}
          onChange={(event) => {
            setImageMode(event.target.value as "nearest" | "entered");
            touch();
          }}
        />
        <Button variant="primary" size="sm" onClick={compute}>
          =
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Enter fractional coordinates as x y z. Nearest-image mode applies lattice translations; the result reports
        those image shifts.
      </div>
      {resultLine(result)}
    </Card>
  );
}
