// Curve Fit > Advanced: Standard curve. The plotted X / Y are the standards
// (known concentration, measured response); type the unknown responses and read
// back each concentration with its 95% interval (calc/standard_curve.py). The
// table copies as tab-separated text, the form a spreadsheet pastes.

import { Button } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { OutOfDateNote, WorkbenchMessage } from "../workbench/WorkbenchParts";
import { copyText } from "../../../lib/clipboard";
import { fmtNum as fmt } from "../../../lib/format";
import type { StandardCurveModel } from "../../../lib/api/standardCurve";
import { useApp } from "../../../store/useApp";
import { standardCurveTable } from "./standardCurveTable";
import { useStandardCurve } from "./useStandardCurve";

const MODELS: { value: StandardCurveModel; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "quadratic", label: "Quadratic" },
  { value: "4pl", label: "4-parameter logistic" },
];

export default function StandardCurveSection() {
  const s = useStandardCurve();
  const setStatus = useApp((st) => st.setStatus);
  const r = s.result;
  const copy = async () => {
    if (!r) return;
    const ok = await copyText(standardCurveTable(r, "tsv"));
    const n = r.unknowns.length;
    setStatus(ok ? `copied ${n} standard-curve reading${n === 1 ? "" : "s"}` : "clipboard unavailable");
  };
  const failure = s.failure;

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Standard curve</label>
      <div className="qzk-ds-meta" style={{ marginTop: 2 }}>
        The plotted X / Y are the standards. Type the responses of your unknowns to read their concentrations.
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <select
          className="qz-select"
          aria-label="standard curve model"
          value={s.model}
          onChange={(e) => s.setModel(e.target.value as StandardCurveModel)}
        >
          {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <NumberField
          value={String(s.replicates)}
          onChange={(v) => s.setReplicates(Math.max(1, Math.round(Number(v)) || 1))}
          width={48}
          aria-label="replicate readings per unknown"
        />
        <span className="qzk-ds-meta">replicate readings per unknown</span>
      </div>
      <textarea
        className="qz-input"
        style={{ marginTop: 6, width: "100%", minHeight: 48, fontFamily: "var(--font-mono)" }}
        aria-label="unknown responses"
        placeholder="Unknown responses, e.g. 0.42 1.07 2.3"
        value={s.responses}
        onChange={(e) => s.setResponses(e.target.value)}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <Button
          size="sm"
          disabled={!s.hasDataset || s.busy}
          onClick={() => void s.run()}
          title="Fit the plotted standards and read the unknown responses off the curve"
        >
          {s.busy ? "Fitting…" : "Read unknowns"}
        </Button>
        {r && <Button size="sm" variant="ghost" onClick={s.clear}>Clear standard curve</Button>}
      </div>
      <WorkbenchMessage
        refusal={failure?.refusal ? failure.message : null}
        error={failure && !failure.refusal ? failure.message : null}
      />
      {r && (
        <section style={{ marginTop: 8 }} aria-label="Standard curve results">
          {s.stale && (
            <OutOfDateNote block>
              the standards or settings changed after this fit. Read the unknowns again before copying.
            </OutOfDateNote>
          )}
          <div className="qzk-ds-meta" style={{ fontFamily: "var(--font-mono)" }}>
            {r.paramNames.map((n, i) => `${n} = ${fmt(r.params[i])}`).join(", ")} · R² = {fmt(r.r2)} · n = {r.n}
          </div>
          <table className="qz-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>response</th>
                <th>concentration</th>
                <th>{Math.round(r.confidence * 100)}% interval</th>
                <th>note</th>
              </tr>
            </thead>
            <tbody>
              {r.unknowns.map((u, i) => (
                <tr key={i} title={u.reason ?? undefined}>
                  <td>{fmt(u.y)}</td>
                  <td>{u.x == null ? "none" : fmt(u.x)}</td>
                  <td>{u.lower == null || u.upper == null ? "" : `${fmt(u.lower)} to ${fmt(u.upper)}`}</td>
                  <td style={{ color: u.status === "ok" ? undefined : "var(--danger)" }}>
                    {u.status === "ok" ? "" : u.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 4 }}>
            <Button size="sm" disabled={s.stale} onClick={() => void copy()} title="Copy the readings as tab-separated text">
              Copy standard-curve readings
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
