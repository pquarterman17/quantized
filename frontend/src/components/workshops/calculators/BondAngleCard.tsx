import { useState } from "react";

import { crystalBondAngle } from "../../../lib/api/crystallography";
import { Select } from "../../primitives";
import { Card, Field, ROW, Button, dual, resultLine, useCard, withTouch, type CardSuccess } from "./shared";
import { assembleCell, type CrystalForm } from "./useCalculators";

type FractionalCoordinate = [number, number, number];

/** One card's `useCard` API, as CrystalTab owns and passes it down. */
type BondAngleCardApi = ReturnType<typeof useCard>;

/** A whole-token number OR a simple fraction ``a/b`` (integers, either side
 *  optionally signed — "1/3", "-1/3", "2/-3"). Anything else falls through
 *  to `Number()` unchanged (still handling plain decimals). */
function parseNumberOrFraction(token: string): number {
  const fraction = /^(-?\d+)\/(-?\d+)$/.exec(token);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator !== 0 ? Number(fraction[1]) / denominator : NaN;
  }
  return Number(token);
}

function parseCoordinate(value: string, label: string): FractionalCoordinate {
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseNumberOrFraction);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(
      `${label} must contain exactly three numeric fractional coordinates (decimals or simple fractions like 1/3)`,
    );
  }
  return parts as FractionalCoordinate;
}

/** Fold the API's ambiguous-tie warning(s) into the success text/copy value,
 *  so a genuine equidistant-image tie is visible right on the card. */
function withAmbiguityNote(success: CardSuccess, warnings: string[]): CardSuccess {
  if (warnings.length === 0) return success;
  const note = `ambiguous: ${warnings.join(" ")}`;
  return { text: `${success.text}  ⚠ ${note}`, copyValue: `${success.copyValue}  ${note}` };
}

/** ``card`` is owned by the parent (CrystalTab) — the SAME `useCard`
 *  instance its shared-lattice `updateLattice()` touch path already
 *  invalidates alongside the interplanar-angle card. That is the single
 *  lattice-invalidation mechanism for every card on the tab; this component
 *  no longer runs its own effect-based lattice-signature comparison to
 *  duplicate it. */
export default function BondAngleCard({
  crystal,
  card,
}: {
  crystal: CrystalForm;
  card: BondAngleCardApi;
}) {
  const [atom1, setAtom1] = useState("0.25 0 0");
  const [vertex, setVertex] = useState("0 0 0");
  const [atom3, setAtom3] = useState("0 0.25 0");
  const [imageMode, setImageMode] = useState<"nearest" | "entered">("nearest");
  const { result, run, touch } = card;

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
        const success = dual`θ = ${response.angle_deg}° · r₁ = ${response.distance1} Å · r₂ = ${response.distance3} Å · images (${image1}), (${image3})`;
        return withAmbiguityNote(success, response.warnings);
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
        <Button aria-label="Calculate" variant="primary" size="sm" onClick={compute}>
          =
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Enter fractional coordinates as x y z (decimals or simple fractions like 1/3). Nearest-image mode applies
        lattice translations; the result reports those image shifts and flags a genuinely ambiguous (equidistant)
        image.
      </div>
      {resultLine(result)}
    </Card>
  );
}
