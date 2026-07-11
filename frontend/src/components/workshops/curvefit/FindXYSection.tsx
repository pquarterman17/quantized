// Find X from Y / Y from X (MAIN #15) — a compact affordance shown once a
// fit result exists: type an X to read the fitted model's Y, or a Y to see
// every X where the fitted curve crosses it within the fitted data range
// (all crossings, e.g. both sides of a peak — not just the first). Rendered
// by both CurveFitPanel (registry models) and EquationModelPanel (saved
// custom equations); the target shape (model XOR equation + params + the
// fitted x-range) is all either caller needs to provide.

import { Button, NumberField } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import { useFindXY, type FindXYTarget } from "./useFindXY";

interface Props {
  target: FindXYTarget;
}

export default function FindXYSection({ target }: Props) {
  const s = useFindXY(target);

  return (
    <div style={{ marginTop: 12 }}>
      <label className="qzk-field-lbl">Find X / Y</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
        <NumberField
          value={s.xInput}
          onChange={s.setXInput}
          placeholder="X"
          width={64}
          aria-label="find Y at this X"
        />
        <Button size="sm" disabled={s.busy} onClick={() => void s.findY()}>
          → Y
        </Button>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <NumberField
          value={s.yInput}
          onChange={s.setYInput}
          placeholder="Y"
          width={64}
          aria-label="find X at this Y"
        />
        <Button size="sm" disabled={s.busy} onClick={() => void s.findX()}>
          → X
        </Button>
      </div>
      {s.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--danger)" }}>
          {s.error}
        </div>
      )}
      {s.yResult != null && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, fontFamily: "var(--font-mono)" }}>
          Y = {fmt(s.yResult)}
        </div>
      )}
      {s.xResults != null && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, fontFamily: "var(--font-mono)" }}>
          {s.xResults.length === 0
            ? "no crossings in the fitted range"
            : `X = ${s.xResults.map((v) => fmt(v)).join(", ")}`}
        </div>
      )}
    </div>
  );
}
