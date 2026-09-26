// Apply a saved transformation recipe (P2.5 box 4) — view. Pick the datasets;
// each one shows its PREFLIGHT before anything runs: how the recipe's expected
// columns bind to its own (rebindable — pick another column, or a blank one
// for a column no step reads), and every refusal or note (missing column,
// unit mismatch, missing metadata, a recorded input not in this workspace).
// Apply runs the ready ones — one derived output each, with the recipe's
// name and revision in its provenance, and one undo step for the whole apply.
// Thin: state in useApplyRecipe, the run in applyRecipe.

import { Checkbox } from "../../primitives/Checkbox";
import { Button, Select, StatusDot } from "../../primitives";
import { useApplyRecipe, type PickState } from "./useApplyRecipe";
import { runnableSteps, type Binding } from "../../../lib/recipePreflight";
import type { ExpectedColumn } from "../../../lib/recipeExpect";
import type { AnalysisTemplate } from "../../../lib/template";

const bindingValue = (b: Binding): string => (b === null ? "" : b === "blank" ? "blank" : String(b));
const parseBinding = (v: string): Binding => (v === "" ? null : v === "blank" ? "blank" : Number(v));
const withUnit = (name: string, unit: string): string => (unit ? `${name} (${unit})` : name);

/** One picked dataset's bindings and preflight. */
function PickPreflight({
  pick,
  columns,
  onBind,
}: {
  pick: PickState;
  columns: readonly ExpectedColumn[];
  onBind: (column: number, b: Binding) => void;
}) {
  const { ds, bindings, preflight } = pick;
  const options = [
    { value: "", label: "— not bound —" },
    { value: "blank", label: "(blank column)" },
    ...ds.data.labels.map((l, j) => ({ value: String(j), label: withUnit(l, ds.data.units[j] ?? "") })),
  ];
  return (
    <div role="group" aria-label={`Preflight ${ds.name}`} style={{ marginTop: 6, paddingLeft: 6, borderLeft: "2px solid var(--border-soft)" }}>
      <StatusDot tone={preflight.blocked ? "danger" : "ok"} label={`${ds.name} — ${preflight.blocked ? "refused" : "ready"}`} />
      {columns.map((c, i) =>
        c.required || typeof bindings[i] !== "number" ? (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
            <span className="qzk-ds-meta" style={{ minWidth: 90 }}>
              {withUnit(c.name, c.unit)}
              {c.required ? "" : " (unused)"} ←
            </span>
            <Select
              aria-label={`Bind ${c.name} in ${ds.name}`}
              options={options}
              value={bindingValue(bindings[i] ?? null)}
              onChange={(e) => onBind(i, parseBinding(e.target.value))}
            />
          </div>
        ) : null,
      )}
      {preflight.issues.length > 0 && (
        <ul aria-label={`Issues for ${ds.name}`} className="qzk-ds-meta" style={{ margin: "2px 0 0", paddingLeft: 16 }}>
          {preflight.issues.map((x, k) => (
            <li key={k} data-kind={x.kind} style={x.blocking ? { color: "var(--danger)" } : undefined}>
              {x.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ApplyRecipeSection({ recipe, onClose }: { recipe: AnalysisTemplate; onClose: () => void }) {
  const a = useApplyRecipe(recipe);
  const columns = recipe.expects?.columns ?? [];
  const steps = runnableSteps(recipe.steps);
  const anyUnits = a.picks.some((p) => p.preflight.unitMismatch);
  return (
    <div role="region" aria-label={`Apply recipe ${recipe.name}`} style={{ marginTop: 8, padding: 6, border: "1px solid var(--border-soft)", borderRadius: 4 }}>
      <div className="qzk-ds-meta">
        Apply “{recipe.name}”{recipe.revision ? ` (revision ${recipe.revision})` : ""} — {steps.length} step
        {steps.length === 1 ? "" : "s"}: {steps.map((s) => s.label).join(" → ") || "none"}
      </div>
      {!recipe.expects && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Saved without an expected input: columns cannot be checked or rebound; steps read them by position.
        </div>
      )}
      <label className="qzk-field-lbl" style={{ marginTop: 6, display: "block" }}>Apply to</label>
      <div role="group" aria-label="Datasets to apply to" style={{ maxHeight: 110, overflowY: "auto" }}>
        {a.datasets.map((d) => (
          <div key={d.id}>
            <Checkbox checked={a.picked.has(d.id)} onChange={() => a.togglePick(d.id)}>
              {d.name}
            </Checkbox>
          </div>
        ))}
      </div>
      {a.picks.map((p) => (
        <PickPreflight key={p.ds.id} pick={p} columns={columns} onBind={(i, b) => a.bind(p.ds.id, i, b)} />
      ))}
      {anyUnits && (
        <div style={{ marginTop: 6 }}>
          <Checkbox checked={a.ackUnits} onChange={a.setAckUnits}>
            Apply despite the unit mismatch
          </Checkbox>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        <Button variant="primary" size="sm" disabled={a.running || a.ready === 0} onClick={() => void a.apply()}>
          {a.running ? "Applying…" : `Apply to ${a.ready} dataset${a.ready === 1 ? "" : "s"}`}
        </Button>
        {a.picks.length > a.ready && (
          <span className="qzk-ds-meta">{a.picks.length - a.ready} refused — not applied</span>
        )}
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {a.results && (
        <ul aria-label="Apply results" className="qzk-ds-meta" style={{ margin: "6px 0 0", paddingLeft: 16 }}>
          {a.results.map((r) => (
            <li key={r.datasetId} data-status={r.status} style={r.status === "ok" ? undefined : { color: "var(--danger)" }}>
              {r.name}: {r.status === "ok" ? r.note : `${r.status} — ${r.note}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
