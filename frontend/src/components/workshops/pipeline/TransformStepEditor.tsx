// Pipeline panel — the param editor for a recorded `transform` step (audit
// P2.5). Lazy (StepEditor mounts it on demand), so lib/transformRun stays out
// of the panel's own chunk. Fields come from transformStepForm.ts; Apply is
// enabled only when the replay's own validator accepts the draft, and hands
// the store the validated params plus the regenerated label and script line.

import { useState } from "react";

import { Button, Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import type { PipelineStep } from "../../../lib/pipeline";
import { openMetaFactors } from "../../../store/metaFactorsDialog";
import { openSimsDialog } from "../../../store/simsDialog";
import { openTransformPreview } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import {
  checkTransformEdit,
  columnOptions,
  transformForm,
  type FieldSpec,
  type WorkshopRoute,
} from "./transformStepForm";

type Draft = Record<string, unknown>;
type Ref = { id?: unknown };

/** The dataset the step acts on: its recorded input when that was not the
 *  run's target, else the active dataset. */
function primaryIdOf(params: Draft, activeId: string | null): string | null {
  const input = params.input as Ref | undefined;
  if (params.inputIsTarget === false && typeof input?.id === "string") return input.id;
  return activeId;
}

const refIds = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap((r: Ref) => (typeof r?.id === "string" ? [r.id] : []));

/** "Open in workshop": the op's workshop, seeded with the step's datasets
 *  that are still in the workspace (`liveIds`). */
function openWorkshop(
  route: WorkshopRoute,
  params: Draft,
  primary: string | null,
  liveIds: ReadonlySet<string>,
  openMath: () => void,
): void {
  const live = (ids: string[]) => ids.filter((id) => liveIds.has(id));
  const withPrimary = live([...(primary ? [primary] : []), ...refIds(params.with)]);
  const applied = live(refIds(params.datasets));
  if (route === "join" || route === "merge") openTransformPreview(route, withPrimary);
  else if (route === "algebra") openMath();
  else if (route === "sims") openSimsDialog(primary ?? "");
  else openMetaFactors(applied.length ? applied : withPrimary);
}

const fieldBox = { display: "inline-flex", flexDirection: "column", gap: 2, marginRight: 8, marginTop: 4 } as const;

function Field({ f, draft, labels, set }: { f: FieldSpec; draft: Draft; labels: readonly string[]; set: (k: string, v: unknown) => void }) {
  const v = draft[f.key];
  if (f.type === "bool") {
    return (
      <div style={{ marginTop: 4 }}>
        <Checkbox checked={v === true} onChange={(on) => set(f.key, on)}>
          {f.label}
        </Checkbox>
      </div>
    );
  }
  if (f.type === "columns") {
    const picked = Array.isArray(v) ? (v as number[]) : [];
    const toggle = (c: number, on: boolean) =>
      set(f.key, on ? [...new Set([...picked, c])].sort((a, b) => a - b) : picked.filter((x) => x !== c));
    return (
      <div role="group" aria-label={f.label} style={{ marginTop: 4, display: "grid", gap: 2, maxHeight: 110, overflowY: "auto" }}>
        <label className="qzk-field-lbl">{f.label}</label>
        {columnOptions(labels, false, picked).map((o) => (
          <Checkbox key={o.value} checked={picked.includes(Number(o.value))} onChange={(on) => toggle(Number(o.value), on)}>
            {o.label}
          </Checkbox>
        ))}
      </div>
    );
  }
  let input;
  if (f.type === "select") {
    input = <Select aria-label={f.label} options={f.options} value={String(v ?? f.fallback)} onChange={(e) => set(f.key, e.target.value)} />;
  } else if (f.type === "column") {
    const cur = typeof v === "number" ? [v] : [];
    const options = columnOptions(labels, f.withX === true, cur);
    input = <Select aria-label={f.label} options={options} value={String(v ?? "")} onChange={(e) => set(f.key, Number(e.target.value))} />;
  } else if (f.type === "number") {
    input = (
      <BufferedNumberField aria-label={f.label} width={90} value={typeof v === "number" ? v : undefined} onValue={(n) => set(f.key, n)} />
    );
  } else {
    input = <NumberField aria-label={f.label} numeric={false} width={140} value={String(v ?? "")} onChange={(t) => set(f.key, t)} />;
  }
  return (
    <span style={fieldBox}>
      <label className="qzk-field-lbl">{f.label}</label>
      {input}
    </span>
  );
}

export default function TransformStepEditor({
  step,
  onApply,
}: {
  step: PipelineStep;
  onApply: (params: Draft, text: { label: string; code: string }) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...step.params });
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const openMath = useApp((s) => s.setDatasetMathOpen);
  const primary = primaryIdOf(step.params, activeId);
  const labels = datasets.find((d) => d.id === primary)?.data.labels ?? [];
  const form = transformForm(draft);
  const check = checkTransformEdit(draft);
  const set = (k: string, v: unknown) =>
    setDraft((d) => {
      const next = { ...d };
      // A cleared optional field is ABSENT (the validator's "not set").
      if (v === undefined || v === "") delete next[k];
      else next[k] = v;
      return next;
    });
  return (
    <div style={{ marginTop: 4 }}>
      {form.fields.map((f) => (
        <Field key={f.key} f={f} draft={draft} labels={labels} set={set} />
      ))}
      {form.note && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginTop: 4 }}>
          {form.note}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {form.fields.length > 0 && (
          <Button size="sm" disabled={!check.ok} onClick={() => check.ok && onApply(check.params, check.text)}>
            Apply
          </Button>
        )}
        {form.workshop && (
          <Button size="sm" onClick={() =>
              openWorkshop(form.workshop!, draft, primary, new Set(datasets.map((d) => d.id)), () => openMath(true))
            }>
            Open in workshop
          </Button>
        )}
      </div>
      {!check.ok && form.fields.length > 0 && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 4 }}>
          {check.error}
        </div>
      )}
    </div>
  );
}
