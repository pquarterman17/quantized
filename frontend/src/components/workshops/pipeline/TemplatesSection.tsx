// Templates section of the Pipeline workshop (#2/#3): save the current steps
// as a named template, load/delete/export/import templates, and batch-run one
// over N picked files (per-file reports + a summary worksheet). Thin — all
// logic lives in useTemplates.
//
// P2.5 box 4 — a saved template is also a TRANSFORMATION RECIPE: Save records
// a description, the next revision, and the input the steps expect (read off
// the example dataset, the recording's input by default — the preview line
// shows what will be required). "Apply…" opens ApplyRecipeSection: apply the
// picked recipe to loaded datasets, with a per-dataset preflight first.

import { useMemo, useRef, useState } from "react";

import { NumberField } from "../../primitives/NumberField";
import { Button, Select } from "../../primitives";
import ApplyRecipeSection from "./ApplyRecipeSection";
import { useTemplates } from "./useTemplates";
import { deriveExpectations, expectationsText, recordingInputId } from "../../../lib/recipeExpect";
import { useApp } from "../../../store/useApp";

export default function TemplatesSection() {
  const t = useTemplates();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const steps = useApp((s) => s.macroSteps);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  // Finding #4: Apply and Batch both toggle this SAME store-wide flag while
  // they run (`applyRecipe`/`runBatch`), so it doubles as the "is either one
  // busy" signal — reading it here, rather than only `t.batch` (batch's own
  // local progress, blind to an apply in flight), is what actually makes
  // them mutually exclusive in both directions.
  const pipelineRunning = useApp((s) => s.pipelineRunning);
  // `undefined` = follow the recording's input; "" = no example (save without
  // an expected input); an id = that dataset.
  const [exampleChoice, setExampleChoice] = useState<string | undefined>(undefined);
  const loaded = useMemo(() => new Set(datasets.map((d) => d.id)), [datasets]);
  const exampleId =
    exampleChoice === "" ? null : exampleChoice && loaded.has(exampleChoice) ? exampleChoice : recordingInputId(steps, loaded, activeId);
  const example = datasets.find((d) => d.id === exampleId);
  const expects = useMemo(() => (example && steps.length ? deriveExpectations(steps, example) : undefined), [example, steps]);
  const recipe = t.templates.find((x) => x.name === picked);

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
      <label className="qzk-field-lbl">Templates &amp; transformation recipes</label>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
        <NumberField
          numeric={false}
          width={130}
          value={name}
          placeholder="save as…"
          aria-label="Template name"
          onChange={setName}
        />
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={() => {
            // null = "no example" picked: save without an expected input.
            void t.saveCurrent(name.trim(), { description, exampleId: exampleChoice === "" ? null : (exampleId ?? undefined) }).then((err) => {
              setError(err);
              if (!err) {
                setName("");
                setDescription("");
              }
            });
          }}
        >
          Save
        </Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => importRef.current?.click()}>
          Import…
        </Button>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void t.importFile(f).then(setError);
            e.target.value = "";
          }}
        />
      </div>
      {steps.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
          <NumberField
            numeric={false}
            width={180}
            value={description}
            placeholder="description (blank keeps the saved one)"
            aria-label="Recipe description"
            onChange={setDescription}
          />
          <Select
            aria-label="Example dataset"
            title="the dataset the recipe's expected input is read from"
            options={[{ value: "", label: "no example" }, ...datasets.map((d) => ({ value: d.id, label: d.name }))]}
            value={exampleId ?? ""}
            onChange={(e) => setExampleChoice(e.target.value)}
          />
        </div>
      )}
      {steps.length > 0 && (
        <div className="qzk-ds-meta" role="note" aria-label="Expected input" style={{ marginTop: 4 }}>
          Expects: {expectationsText(expects)}
        </div>
      )}

      {t.templates.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
          <Select
            aria-label="Saved template"
            options={[
              { value: "", label: "pick a template…" },
              ...t.templates.map((x) => ({ value: x.name, label: x.revision ? `${x.name} (r${x.revision})` : x.name })),
            ]}
            value={picked}
            onChange={(e) => {
              setPicked(e.target.value);
              setApplying(false);
            }}
          />
          <Button size="sm" disabled={!picked} onClick={() => t.load(picked)}>
            Load
          </Button>
          <Button size="sm" disabled={!picked || pipelineRunning} onClick={() => setApplying((a) => !a)}>
            Apply…
          </Button>
          <Button size="sm" disabled={!picked || pipelineRunning} onClick={() => fileRef.current?.click()}>
            Batch…
          </Button>
          <Button size="sm" disabled={!picked} onClick={() => t.exportFile(picked)}>
            Export
          </Button>
          <Button
            aria-label="Delete template"
            size="sm"
            disabled={!picked}
            onClick={() => {
              t.remove(picked);
              setPicked("");
              setApplying(false);
            }}
          >
            ×
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length && picked && !pipelineRunning) void t.runBatch(picked, files);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {recipe && (recipe.description || recipe.expects) && (
        <div className="qzk-ds-meta" style={{ marginTop: 4 }}>
          {recipe.description && <div>{recipe.description}</div>}
          {recipe.expects && <div>Expects: {expectationsText(recipe.expects)}</div>}
        </div>
      )}
      {recipe && applying && (
        // Keyed by revision too: a re-save changes the expected columns, and
        // bindings chosen against the old list must not carry over.
        <ApplyRecipeSection
          key={`${recipe.name}#${recipe.revision ?? 0}`}
          recipe={recipe}
          onClose={() => setApplying(false)}
          disabled={pipelineRunning}
        />
      )}

      {t.batch && (
        <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
          batch {t.batch.done + 1}/{t.batch.total} — {t.batch.current}
          {t.batch.failures.length > 0 && (
            <span style={{ color: "var(--danger)" }}> · {t.batch.failures.length} flagged</span>
          )}
        </div>
      )}
      {error && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
