// Curve Fit — "Compare models" section (lazy chunk). Pick two or more models,
// fit them all to the current selection, and read the comparison table
// (calc.fit_model_compare via useCompareModels): k, adjusted R², ΔAICc, ΔBIC
// and the nested F-test p-value against the simplest candidate.

import { Button, Select } from "../../primitives";
import { IconButton } from "../../primitives/IconButton";
import type { CustomFitModel } from "../../../lib/fitmodels";
import { fmtNum as fmt } from "../../../lib/format";
import { CUSTOM_PREFIX, useCompareModels } from "./useCompareModels";

interface Props {
  /** Picker options (registry models and saved custom equations). */
  options: { value: string; label: string }[];
  /** The workshop's current model, pre-picked. */
  current: string;
  customModels: readonly CustomFitModel[];
}

export default function CompareModelsSection({ options, current, customModels }: Props) {
  const s = useCompareModels([current], customModels);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const addable = options.filter((o) => o.value !== CUSTOM_PREFIX && !s.picked.includes(o.value));
  const r = s.result;

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Compare models</label>
      <Select
        aria-label="Add a model to compare"
        options={[{ value: "", label: "Add a model…" }, ...addable]}
        value=""
        onChange={(e) => s.add(e.target.value)}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {s.picked.map((v) => (
          <span key={v} className="qzk-ds-meta" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            {labelOf(v)}
            <IconButton type="button" aria-label={`Remove ${labelOf(v)}`} onClick={() => s.remove(v)}>
              ×
            </IconButton>
          </span>
        ))}
      </div>
      <div style={{ marginTop: 6 }}>
        <Button size="sm" disabled={!s.canCompare} title="Fit every picked model to this selection and compare them" onClick={() => void s.compare()}>
          {s.busy ? "Comparing…" : "Compare"}
        </Button>
      </div>
      {s.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {s.error}
        </div>
      )}
      {r && !s.busy && (
        <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
          <table className="qz-table" aria-label="Model comparison">
            <thead>
              <tr>
                <th>model</th>
                <th>k</th>
                <th>adj R²</th>
                <th>ΔAICc</th>
                <th>ΔBIC</th>
                <th>F p</th>
              </tr>
            </thead>
            <tbody>
              {r.results.map((e) => (
                <tr key={`${e.kind}:${e.name}`} title={e.error ?? undefined} style={{ opacity: e.error ? 0.6 : 1 }}>
                  <td>{e.kind === "equation" ? `ƒ ${e.name}` : e.name}</td>
                  {e.error ? (
                    <td colSpan={5} style={{ color: "var(--danger)" }}>
                      {e.error}
                    </td>
                  ) : (
                    <>
                      <td>{e.k}</td>
                      <td>{fmt(e.adjR2)}</td>
                      <td>{fmt(e.dAICc)}</td>
                      <td>{fmt(e.dBIC)}</td>
                      <td>{e.name === r.reference ? "ref" : fmt(e.fPvalue)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            Unweighted fits; the F-test against {r.reference ?? "the simplest model"} holds only for nested models.
          </div>
        </div>
      )}
    </div>
  );
}
