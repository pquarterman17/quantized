// "Avoid overlaps" for point labels (plan item 18), a section of PointLabelsCard.
// Off by default (the labels keep today's placement). On: labels are moved to the
// nearest free slot around their point, and a label that ends up farther than the
// leader distance gets a thin line back to its point. The live plot and the vector
// export place them with the same rule (lib/labelPlacement.ts, calc/label_placement.py).

import {
  DEFAULT_LABEL_AVOID, LEADER_DISTANCE_RANGE, LEADER_WIDTH_RANGE, sanitizeLabelAvoid, type LabelAvoid,
} from "../../lib/pointLabelAvoid";

interface Props {
  avoid: LabelAvoid | undefined;
  onChange: (next: LabelAvoid | undefined) => void;
}

export default function PointLabelAvoidControls({ avoid, onChange }: Props) {
  const num = (label: string, key: "leaderDistance" | "leaderWidth", range: readonly [number, number], step: number, unit: string) =>
    avoid && (
      <label className="qz-hint" style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: "var(--font-mono)" }}>
        {label}
        <input
          type="number"
          className="qz-input qz-num"
          aria-label={label}
          min={range[0]}
          max={range[1]}
          step={step}
          value={avoid[key]}
          style={{ width: 72 }}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= range[0] && v <= range[1]) onChange({ ...avoid, [key]: v });
          }}
        />
        {unit}
      </label>
    );
  return (
    <>
      <label className="qz-hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          aria-label="Avoid overlaps"
          checked={!!avoid}
          onChange={(e) => onChange(e.target.checked ? (sanitizeLabelAvoid({}) ?? DEFAULT_LABEL_AVOID) : undefined)}
        />
        Avoid overlaps
      </label>
      {num("Leader distance", "leaderDistance", LEADER_DISTANCE_RANGE, 0.5, "label heights")}
      {num("Leader width", "leaderWidth", LEADER_WIDTH_RANGE, 0.25, "pt")}
      {avoid && (
        <label className="qz-hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            aria-label="Dashed leader lines"
            checked={avoid.leaderDashed}
            onChange={(e) => onChange({ ...avoid, leaderDashed: e.target.checked })}
          />
          Dashed leader lines
        </label>
      )}
    </>
  );
}
