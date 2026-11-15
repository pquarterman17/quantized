// "X from" for a batch summary worksheet (lib/batchSummaryX): the input's
// position, a number in its name, a metadata field or a user-parameter row,
// plus "Sort rows by X". Shared by the curve-fit, peak-model and template
// batches, so the choice reads the same everywhere. `typed` is for a batch
// whose files are not loaded yet (the template file batch): the field or
// parameter is then named by hand, and a file without it is left blank.

import type { SummaryXChoice, SummaryXSource } from "../../../lib/batchSummaryX";
import { pathFromId, pathId, type MetaPath } from "../../../lib/metadataKeys";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";

interface Props {
  choice: SummaryXChoice;
  onChange: (c: SummaryXChoice) => void;
  /** Metadata fields (numeric in at least one input) to offer. */
  metaFields?: { path: MetaPath; label: string }[];
  /** User-parameter row names to offer. */
  params?: string[];
  /** Name the field/parameter by hand instead of picking from `metaFields`/`params`. */
  typed?: boolean;
  disabled?: boolean;
}

const code = (s: SummaryXSource): string =>
  s.kind === "meta" ? `meta:${pathId(s.path)}` : s.kind === "param" ? `param:${s.name}` : s.kind;

export default function SummaryXPicker({ choice, onChange, metaFields = [], params = [], typed = false, disabled }: Props) {
  const s = choice.source;
  const options = [
    { value: "index", label: "Input order (1, 2, …)" },
    { value: "name", label: "Number in the name" },
    ...(typed
      ? [{ value: "meta:", label: "Metadata field…" }, { value: "param:", label: "Parameter row…" }]
      : [
        ...metaFields.map((f) => ({ value: `meta:${pathId(f.path)}`, label: `Metadata: ${f.label}` })),
        ...params.map((p) => ({ value: `param:${p}`, label: `Parameter: ${p}` })),
      ]),
  ];
  const value = typed && (s.kind === "meta" || s.kind === "param") ? `${s.kind}:` : code(s);
  const pick = (v: string) => {
    let source: SummaryXSource = { kind: "index" };
    if (v === "name") source = { kind: "name" };
    else if (v.startsWith("meta:")) source = { kind: "meta", path: (typed ? [] : pathFromId(v.slice(5))) ?? [] };
    else if (v.startsWith("param:")) source = { kind: "param", name: typed ? "" : v.slice(6) };
    onChange({ ...choice, source });
  };
  const text = s.kind === "meta" ? s.path.join(" › ") : s.kind === "param" ? s.name : "";
  const typedText = (t: string) =>
    onChange({
      ...choice,
      source: s.kind === "meta" ? { kind: "meta", path: t.split("›").map((p) => p.trim()).filter(Boolean) } : { kind: "param", name: t },
    });
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>Summary X</span>
      <Select aria-label="summary X from" options={options} value={value} disabled={disabled} onChange={(e) => pick(e.target.value)} />
      {typed && (s.kind === "meta" || s.kind === "param") && (
        <input className="qz-input" aria-label="summary X name" style={{ width: 120 }} value={text} disabled={disabled}
          placeholder={s.kind === "meta" ? "e.g. Temperature" : "e.g. T"} onChange={(e) => typedText(e.target.value)} />
      )}
      <Checkbox checked={choice.sort} disabled={disabled} onChange={(sort) => onChange({ ...choice, sort })}
        title="Order the summary rows by X. Off keeps the inputs' own order; a row with no X goes last.">
        Sort rows by X
      </Checkbox>
    </span>
  );
}
