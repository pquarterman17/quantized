import { Button, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { DEMAG_SHAPES, useDemagCorrection, type DemagShape } from "./useDemagCorrection";

const SHAPE_OPTIONS = [
  { value: "", label: "Choose geometry…" },
  ...DEMAG_SHAPES.map((shape) => ({ value: shape, label: shape })),
];

export default function DemagCorrectionPane() {
  const d = useDemagCorrection();
  return (
    <div style={{ marginTop: 12 }}>
      <label className="qzk-field-lbl" htmlFor="mag-demag-shape">
        Sample geometry and field direction
      </label>
      <Select
        id="mag-demag-shape"
        options={SHAPE_OPTIONS}
        value={d.shape}
        onChange={(event) => d.setShape(event.target.value as DemagShape | "")}
      />
      <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
        Creates a new dataset using H<sub>internal</sub> = H<sub>applied</sub> − NM.
        Magnetization must already be normalized by sample volume.
      </div>
      <div style={{ marginTop: 12 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={d.busy || d.problem !== null}
          onClick={() => void d.apply()}
        >
          {d.busy ? "Correcting…" : "Create internal-field dataset →"}
        </Button>
      </div>
      {d.problem && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>
          {d.problem}
        </div>
      )}
      {d.nFactor != null && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
          Applied N = {fmtNum(d.nFactor)} (4πN = {fmtNum(d.nCgs ?? Number.NaN)}).
          The geometry factor is treated as exact.
        </div>
      )}
      {d.warning && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>
          {d.warning}
        </div>
      )}
      {d.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {d.error}
        </div>
      )}
    </div>
  );
}
