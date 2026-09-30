// Reflectivity workshop — the editor under a graded (spline) film row, loaded
// lazily by LayerTable only once a row is graded. Knots are SLD values in
// 10⁻⁶ Å⁻², evenly spaced from the top of the layer to its bottom; the
// interpolation is calc.sld.spline_sld's. An unparseable knot list stays local
// (with a one-line reason) and never reaches the model.

import { useState } from "react";

import { Select } from "../../primitives";
import { formatKnots, parseKnots, SPLINE_METHODS, type GradedProfile } from "./reflGraded";

export default function GradedLayerEditor({
  layer,
  graded,
  onChange,
}: {
  layer: number;
  graded: GradedProfile;
  onChange: (graded: GradedProfile) => void;
}) {
  const [draft, setDraft] = useState(() => formatKnots(graded.knots));
  const valid = parseKnots(draft) != null;

  const onKnots = (text: string) => {
    setDraft(text);
    const knots = parseKnots(text);
    if (knots) onChange({ ...graded, knots });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "62px 1fr auto", gap: 6, alignItems: "center" }}>
      <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }} title="SLD knots in 10⁻⁶ Å⁻², top to bottom.">
        knots
      </span>
      <input
        className="qz-input qz-num"
        aria-label={`Layer ${layer} SLD knots`}
        title="SLD knots in 10⁻⁶ Å⁻², evenly spaced from top to bottom."
        value={draft}
        onChange={(e) => onKnots(e.target.value)}
      />
      <Select
        aria-label={`Layer ${layer} interpolation`}
        options={SPLINE_METHODS.map((m) => ({ value: m, label: m }))}
        value={graded.method}
        onChange={(e) => onChange({ ...graded, method: e.target.value as GradedProfile["method"] })}
      />
      {!valid && (
        <span className="qzk-ds-meta qzk-msg" role="alert" style={{ gridColumn: "2 / 4", color: "var(--danger)" }}>
          Enter at least two numbers.
        </span>
      )}
    </div>
  );
}
