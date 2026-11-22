// Reshape & combine workshop — the "Clean data" fields (remove duplicate rows,
// fill or drop missing values, z-score / min-max / rank). Thin: values live in
// the hook's form; `formToRun` (transformForm.ts) turns them into the params.

import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { DedupeKeep, FillMethod, StandardizeMethod } from "../../../lib/transformClean";
import { keyOptions } from "./transformForm";
import type { ReshapeState } from "./useReshapePreview";

const gap = { marginTop: 8 };
const box = { maxHeight: 110, overflowY: "auto", display: "grid", gap: 2 } as const;
const faint = { marginTop: 4, color: "var(--text-faint)" };

function Columns({ r, label }: { r: ReshapeState; label: string }) {
  const f = r.form;
  const data = r.datasets.find((d) => d.id === f.primary)?.data;
  const toggle = (c: number, on: boolean) =>
    r.setForm({ cleanChannels: on ? [...new Set([...f.cleanChannels, c])].sort((a, b) => a - b) : f.cleanChannels.filter((x) => x !== c) });
  return (
    <>
      <label className="qzk-field-lbl" style={gap}>{label}</label>
      <div role="group" aria-label={label} style={box}>
        {(data?.labels ?? []).map((l, i) => (
          <Checkbox key={i} checked={f.cleanChannels.includes(i)} onChange={(on) => toggle(i, on)}>
            {l || `column ${i + 1}`}
          </Checkbox>
        ))}
      </div>
    </>
  );
}

export default function ReshapeCleanFields({ r }: { r: ReshapeState }) {
  const f = r.form;
  const data = r.datasets.find((d) => d.id === f.primary)?.data;
  if (f.op === "dedupe") {
    const toggle = (v: string, on: boolean) =>
      r.setForm({ dedupeKeys: on ? [...new Set([...f.dedupeKeys, v])] : f.dedupeKeys.filter((x) => x !== v) });
    return (
      <>
        <label className="qzk-field-lbl" style={gap}>Rows match when these columns are equal</label>
        <div role="group" aria-label="Key columns" style={box}>
          {keyOptions(data).map((o) => (
            <Checkbox key={o.value} checked={f.dedupeKeys.includes(o.value)} onChange={(on) => toggle(o.value, on)}>
              {o.label}
            </Checkbox>
          ))}
        </div>
        <div className="qzk-helptext" style={faint}>None ticked compares the whole row.</div>
        <label className="qzk-field-lbl" style={gap}>Keep</label>
        <Select
          aria-label="Keep"
          options={[{ value: "first", label: "the first of each group" }, { value: "last", label: "the last of each group" }]}
          value={f.keep}
          onChange={(e) => r.setForm({ keep: e.target.value as DedupeKeep })}
        />
      </>
    );
  }
  if (f.op === "fillmissing") {
    return (
      <>
        <label className="qzk-field-lbl" style={gap}>Method</label>
        <Select
          aria-label="Fill method"
          options={[
            { value: "linear", label: "Interpolate linearly on X (between present values)" },
            { value: "previous", label: "Carry the previous value forward" },
            { value: "drop", label: "Drop rows with a missing value" },
          ]}
          value={f.fillMethod}
          onChange={(e) => r.setForm({ fillMethod: e.target.value as FillMethod })}
        />
        <Columns r={r} label="Columns to check" />
      </>
    );
  }
  return (
    <>
      <label className="qzk-field-lbl" style={gap}>Method</label>
      <Select
        aria-label="Standardize method"
        options={[
          { value: "zscore", label: "Z-score (mean 0, sample SD 1)" },
          { value: "minmax", label: "Min-max (0 to 1)" },
          { value: "rank", label: "Rank (ties share their average)" },
        ]}
        value={f.standardizeMethod}
        onChange={(e) => r.setForm({ standardizeMethod: e.target.value as StandardizeMethod })}
      />
      <Columns r={r} label="Columns to standardize" />
    </>
  );
}
