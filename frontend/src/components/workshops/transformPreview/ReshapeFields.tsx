// Reshape & combine workshop — the per-op parameter fields. Thin: every value
// lives in the hook's form (useReshapePreview), and `formToRun`
// (transformForm.ts) turns it into the params the preview and commit share.

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { AppendMatch } from "../../../lib/mergeByName";
import type { JoinMode } from "../../../lib/worksheetJoin";
import type { AggregateMode } from "../../../lib/worksheetTransforms";
import { keyOptions } from "./transformForm";
import type { ReshapeState } from "./useReshapePreview";

const gap = { marginTop: 8 };

function DatasetSelect({ r, label, value, onChange }: { r: ReshapeState; label: string; value: string; onChange: (id: string) => void }) {
  return (
    <Select
      aria-label={label}
      options={r.datasets.map((d) => ({ value: d.id, label: d.name }))}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function columnOptions(r: ReshapeState, withX: boolean) {
  const data = r.datasets.find((d) => d.id === r.form.primary)?.data;
  const cols = (data?.labels ?? []).map((l, i) => ({ value: String(i), label: l || `column ${i + 1}` }));
  return withX ? [{ value: "-1", label: "X (x)" }, ...cols] : cols;
}

function AppendFields({ r }: { r: ReshapeState }) {
  const f = r.form;
  const toggle = (id: string, on: boolean) =>
    r.setForm({ appendIds: on ? (f.appendIds.includes(id) ? f.appendIds : [...f.appendIds, id]) : f.appendIds.filter((x) => x !== id) });
  return (
    <>
      <label className="qzk-field-lbl">Datasets to append, in order</label>
      <div role="group" aria-label="Datasets to append" style={{ maxHeight: 110, overflowY: "auto", display: "grid", gap: 2 }}>
        {r.datasets.map((d) => (
          <Checkbox key={d.id} checked={f.appendIds.includes(d.id)} onChange={(on) => toggle(d.id, on)}>
            {d.name}
          </Checkbox>
        ))}
      </div>
      {f.appendIds.length > 1 && (
        <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
          Order: {f.appendIds.map((id) => r.datasets.find((d) => d.id === id)?.name ?? id).join(" → ")}
        </div>
      )}
      <label className="qzk-field-lbl" style={gap}>Match columns</label>
      <Select
        aria-label="Match columns"
        options={[
          { value: "position", label: "By position (column 1 to column 1)" },
          { value: "name", label: "By column name (missing columns → NaN)" },
        ]}
        value={f.match}
        onChange={(e) => r.setForm({ match: e.target.value as AppendMatch })}
      />
    </>
  );
}

function JoinFields({ r }: { r: ReshapeState }) {
  const f = r.form;
  const find = (id: string) => r.datasets.find((d) => d.id === id)?.data;
  return (
    <>
      <label className="qzk-field-lbl">Left dataset and key</label>
      <DatasetSelect r={r} label="Left dataset" value={f.primary} onChange={(id) => r.setForm({ primary: id })} />
      <Select aria-label="Left key" options={keyOptions(find(f.primary))} value={f.leftKey} onChange={(e) => r.setForm({ leftKey: e.target.value })} style={{ marginTop: 4 }} />
      <label className="qzk-field-lbl" style={gap}>Right dataset and key</label>
      <DatasetSelect r={r} label="Right dataset" value={f.right} onChange={(id) => r.setForm({ right: id })} />
      <Select aria-label="Right key" options={keyOptions(find(f.right))} value={f.rightKey} onChange={(e) => r.setForm({ rightKey: e.target.value })} style={{ marginTop: 4 }} />
      <label className="qzk-field-lbl" style={gap}>Rows to retain</label>
      <Select
        aria-label="Rows to retain"
        options={[
          { value: "inner", label: "inner — keys in both" },
          { value: "left", label: "left — every left key" },
          { value: "right", label: "right — every right key" },
          { value: "full", label: "full — every key" },
        ]}
        value={f.mode}
        onChange={(e) => r.setForm({ mode: e.target.value as JoinMode })}
      />
      <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
        Duplicate keys keep their first row. A text or categorical key matches by its text.
      </div>
    </>
  );
}

function StackFields({ r }: { r: ReshapeState }) {
  const f = r.form;
  const cols = columnOptions(r, false);
  const toggle = (c: number, on: boolean) =>
    r.setForm({ channels: on ? [...new Set([...f.channels, c])].sort((a, b) => a - b) : f.channels.filter((x) => x !== c) });
  return (
    <>
      <label className="qzk-field-lbl" style={gap}>Columns to stack</label>
      <div role="group" aria-label="Columns to stack" style={{ maxHeight: 110, overflowY: "auto", display: "grid", gap: 2 }}>
        {cols.map((c) => (
          <Checkbox key={c.value} checked={f.channels.includes(Number(c.value))} onChange={(on) => toggle(Number(c.value), on)}>
            {c.label}
          </Checkbox>
        ))}
      </div>
    </>
  );
}

function UnstackFields({ r }: { r: ReshapeState }) {
  const f = r.form;
  const cols = columnOptions(r, true);
  const pick = (label: string, value: number, onChange: (v: number) => void) => (
    <>
      <label className="qzk-field-lbl" style={gap}>{label}</label>
      <Select aria-label={label} options={cols} value={String(value)} onChange={(e) => onChange(Number(e.target.value))} />
    </>
  );
  return (
    <>
      {pick("Row key", f.key, (key) => r.setForm({ key }))}
      {pick("Category column", f.category, (category) => r.setForm({ category }))}
      {pick("Value column", f.value, (value) => r.setForm({ value }))}
      <label className="qzk-field-lbl" style={gap}>Duplicate key/category cells</label>
      <Select
        aria-label="Duplicate key/category cells"
        options={["mean", "first", "last"].map((m) => ({ value: m, label: m }))}
        value={f.aggregate}
        onChange={(e) => r.setForm({ aggregate: e.target.value as AggregateMode })}
      />
    </>
  );
}

export default function ReshapeFields({ r }: { r: ReshapeState }) {
  const f = r.form;
  if (f.op === "merge") return <AppendFields r={r} />;
  if (f.op === "join") return <JoinFields r={r} />;
  return (
    <>
      <label className="qzk-field-lbl">Dataset</label>
      <DatasetSelect r={r} label="Dataset" value={f.primary} onChange={(id) => r.setForm({ primary: id })} />
      {f.op === "stack" && <StackFields r={r} />}
      {f.op === "unstack" && <UnstackFields r={r} />}
    </>
  );
}
