// Reflectivity workshop — the editor under a graded (spline) film row, loaded
// lazily by LayerTable only once a row is graded. Knots are SLD values in
// 10⁻⁶ Å⁻², top to bottom; the interpolation is calc.sld.spline_sld's. With
// absorption on, each knot also has an absorption (imaginary SLD) value. The
// knots sit evenly spaced unless given positions (fractions of the thickness).
// An unparseable list stays local (with a one-line reason) and never reaches
// the model; a parsed profile the backend would refuse (calc/refl_graded.py)
// is shown with its reason, and the simulate/fit refuse it the same way.

import { Select } from "../../primitives";
import { IconButton } from "../../primitives/IconButton";
import GradedListField from "./GradedListField";
import {
  formatKnots,
  formatPositions,
  gradedProblem,
  parseKnots,
  parsePositions,
  SPLINE_METHODS,
  type GradedProfile,
} from "./reflGraded";

/** `g` with `key` set, or removed when `v` is undefined. */
function withList(g: GradedProfile, key: "isld" | "positions", v: number[] | undefined): GradedProfile {
  const { [key]: _old, ...rest } = g;
  return v ? { ...rest, [key]: v } : rest;
}

type EditorProps = { layer: number; graded: GradedProfile; onChange: (graded: GradedProfile) => void };

/** The absorption row: a toggle, and one absorption value per knot when on
 *  (all knots or none, as calc/refl_graded.py requires). */
function AbsorptionRow({ layer, graded, onChange }: EditorProps) {
  const isld = graded.isld;
  const toggle = (
    <label className="qz-check" title="Give each knot an absorption (imaginary SLD) value.">
      <input
        type="checkbox"
        aria-label={`Layer ${layer} absorption`}
        checked={isld != null}
        onChange={(e) => onChange(withList(graded, "isld", e.target.checked ? graded.knots.map(() => 0) : undefined))}
      />
    </label>
  );
  if (!isld) {
    return (
      <>
        <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>absorption</span>
        <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>none</span>
        {toggle}
      </>
    );
  }
  return (
    <GradedListField
      label="absorption"
      name={`Layer ${layer} absorption knots`}
      title="Absorption per knot in 10⁻⁶ Å⁻², top to bottom."
      value={isld}
      format={formatKnots}
      parse={parseKnots}
      onCommit={(v) => onChange({ ...graded, isld: v })}
      invalid="Enter at least two numbers."
    >
      {toggle}
    </GradedListField>
  );
}

export default function GradedLayerEditor({ layer, graded, onChange }: EditorProps) {
  const problem = gradedProblem(layer, graded);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "62px 1fr auto", gap: 6, alignItems: "center" }}>
      <GradedListField
        label="knots"
        name={`Layer ${layer} SLD knots`}
        title="SLD knots in 10⁻⁶ Å⁻², top to bottom."
        value={graded.knots}
        format={formatKnots}
        parse={parseKnots}
        onCommit={(knots) => onChange({ ...graded, knots })}
        invalid="Enter at least two numbers."
      >
        <Select
          aria-label={`Layer ${layer} interpolation`}
          options={SPLINE_METHODS.map((m) => ({ value: m, label: m }))}
          value={graded.method}
          onChange={(e) => onChange({ ...graded, method: e.target.value as GradedProfile["method"] })}
        />
      </GradedListField>
      <AbsorptionRow layer={layer} graded={graded} onChange={onChange} />
      <GradedListField
        label="positions"
        name={`Layer ${layer} knot positions`}
        title="Knot depths as fractions of the thickness (0 top, 1 bottom); blank is evenly spaced."
        placeholder="evenly spaced"
        value={graded.positions}
        format={formatPositions}
        parse={parsePositions}
        onCommit={(v) => onChange(withList(graded, "positions", v))}
        invalid="Enter positions as numbers from 0 to 1."
      >
        <IconButton
          aria-label={`Layer ${layer} evenly spaced`}
          title="Space the knots evenly."
          disabled={graded.positions == null}
          onClick={() => onChange(withList(graded, "positions", undefined))}
        >
          ↺
        </IconButton>
      </GradedListField>
      {problem && (
        <span className="qzk-ds-meta qzk-msg" role="alert" style={{ gridColumn: "2 / 4", color: "var(--danger)" }}>
          {problem}
        </span>
      )}
    </div>
  );
}
