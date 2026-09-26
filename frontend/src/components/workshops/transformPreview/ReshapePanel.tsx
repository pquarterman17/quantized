// Reshape & combine workshop — view (audit P2.5, "previewed append, keyed
// join, reshape"). Pick an operation and its fields; the result is computed
// LIVE and shown as its first rows (names + units), its size against the
// inputs', and every warning, before Create adds anything. Thin — the logic
// lives in useReshapePreview.

import ToolWindow from "../../overlays/ToolWindow";
import TransformPreviewTable from "../../overlays/TransformPreviewTable";
import TransformWarningList from "../../overlays/TransformWarningList";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { PREVIEW_CAP } from "../../../lib/transformPreviewCompute";
import { useTransformPreviewDialog, type PreviewOp } from "../../../store/transformPreviewDialog";
import ReshapeFields from "./ReshapeFields";
import { OP_OPTIONS } from "./transformForm";
import { useReshapePreview, type ReshapeState } from "./useReshapePreview";

const gap = { marginTop: 8 };
const faint = { marginTop: 4, color: "var(--text-faint)" };
const size = (rows: number, cols: number) => `${rows} row${rows === 1 ? "" : "s"} × ${cols} column${cols === 1 ? "" : "s"}`;

function Preview({ r }: { r: ReshapeState }) {
  if (r.formError) return <div className="qzk-ds-meta" style={{ ...gap, color: "var(--text-faint)" }}>{r.formError}</div>;
  if (r.loading) return <div className="qzk-ds-meta" style={gap} aria-live="polite">Previewing…</div>;
  if (r.error) {
    const byName = r.form.op === "merge" && r.form.match === "position" && r.error.includes("column-count");
    return (
      <div className="qzk-ds-meta" role="alert" style={{ ...gap, color: "var(--danger)" }}>
        {r.error}
        {byName && " — match columns by name instead."}
      </div>
    );
  }
  const c = r.computed;
  if (!c) return null;
  return (
    <div style={gap} role="group" aria-label="Transform preview">
      <ul className="qzk-ds-meta" aria-label="Preview size" style={{ margin: 0, paddingLeft: 16 }}>
        {c.preview.inputs.map((i, k) => (
          <li key={k}>{`${i.name}: ${size(i.rows, i.cols)}`}</li>
        ))}
        <li style={{ fontWeight: 600 }}>{`Result “${c.name}”: ${size(c.data.time.length, c.data.labels.length)} (plus X)`}</li>
      </ul>
      {r.previewOnly && (
        <div className="qzk-ds-meta" style={faint}>
          Preview only: counted on the loaded preview of a book that is still loading; the full data is used when you create.
        </div>
      )}
      {c.preview.previewCapped && (
        <div className="qzk-ds-meta" style={faint}>
          {`Preview shows the first ${PREVIEW_CAP} rows; the created result is the full one.`}
        </div>
      )}
      <TransformPreviewTable data={c.data} />
      <TransformWarningList warnings={c.preview.warnings} />
    </div>
  );
}

/** Remounted on every opening, so running a command again while the
 *  workshop is open re-seeds it from the new selection and op. */
export default function ReshapePanel() {
  const opened = useTransformPreviewDialog((s) => s.opened);
  return <ReshapeWorkshop key={opened} />;
}

function ReshapeWorkshop() {
  const r = useReshapePreview();
  return (
    <ToolWindow id="reshape" title="Reshape & combine" width={380} onClose={r.close}>
      {!r.datasets.length ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>Load a dataset first.</div>
      ) : (
        <>
          <label className="qzk-field-lbl">Operation</label>
          <Select
            aria-label="Operation"
            options={OP_OPTIONS}
            value={r.form.op}
            onChange={(e) => r.setForm({ op: e.target.value as PreviewOp })}
            style={{ marginBottom: 8 }}
          />
          <ReshapeFields r={r} />
          <Preview r={r} />
          {(r.blockedByUnits || r.unitsAcknowledged) && (
            <div style={{ marginTop: 6 }}>
              <Checkbox checked={r.unitsAcknowledged} onChange={r.setUnitsAcknowledged}>
                Create despite the unit mismatch
              </Checkbox>
            </div>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={!r.canCreate}
            onClick={() => void r.create()}
            style={{ marginTop: 12, width: "100%" }}
          >
            {r.busy ? "Creating…" : "Create"}
          </Button>
          {r.commitError && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
              {r.commitError}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
