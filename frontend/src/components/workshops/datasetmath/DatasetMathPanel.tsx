// Dataset Math workshop — view. A draggable ToolWindow: pick dataset A, an
// operation (A±B, A×B, A/B, asymmetry), and dataset B; B is interpolated onto
// A's x-grid and the result is written to the library. Thin — logic in the hook.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { OPERATIONS, useDatasetMath } from "./useDatasetMath";

const INTERP = ["pchip", "linear", "spline"];

export default function DatasetMathPanel() {
  const setOpen = useApp((s) => s.setDatasetMathOpen);
  const m = useDatasetMath();
  const dsOptions = m.datasets.map((d) => ({ value: d.id, label: d.name }));
  const enough = m.datasets.length >= 2;

  return (
    <ToolWindow title="Dataset Math" width={320} onClose={() => setOpen(false)}>
      {!enough ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Load at least two datasets to combine.
        </div>
      ) : (
        <>
          <label className="qzk-field-lbl">Dataset A</label>
          <Select options={dsOptions} value={m.idA} onChange={(e) => m.setIdA(e.target.value)} />

          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Operation
          </label>
          <Select
            options={OPERATIONS}
            value={m.operation}
            onChange={(e) => m.setOperation(e.target.value)}
          />

          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Dataset B
          </label>
          <Select options={dsOptions} value={m.idB} onChange={(e) => m.setIdB(e.target.value)} />

          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Interpolate B onto A
          </label>
          <Select
            options={INTERP.map((v) => ({ value: v, label: v }))}
            value={m.interp}
            onChange={(e) => m.setInterp(e.target.value)}
          />

          <Button
            variant="primary"
            size="sm"
            disabled={m.busy || m.idA === m.idB}
            onClick={() => void m.compute()}
            style={{ marginTop: 12, width: "100%" }}
          >
            {m.busy ? "Computing…" : "Combine → new dataset"}
          </Button>

          {m.idA === m.idB && (
            <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
              Pick two different datasets.
            </div>
          )}
          {m.error && (
            <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
              {m.error}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
