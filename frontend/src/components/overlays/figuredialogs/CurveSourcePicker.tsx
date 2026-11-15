// One curve's source in Layer Contents (gap audit 3 N1): which dataset, which
// X, which Y. Choosing another dataset clears the Y (and returns X to the
// dataset's own) — the user picks them again; a column is never carried over
// by position or by name to a different dataset (fail closed).

import { Select } from "../../primitives";
import type { Dataset } from "../../../lib/types";

export interface CurveBinding {
  datasetId: string;
  xKey: number | null;
  yKey: number;
}

const OWN_X = "own";
const NO_Y = "-1";

/** Unique option labels ("name", then "name (2)" for a repeated name). */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n} (${k})`;
  });
}

export default function CurveSourcePicker({
  sources,
  value,
  onChange,
  label,
}: {
  sources: readonly Dataset[];
  value: CurveBinding;
  onChange: (b: CurveBinding) => void;
  /** Prefix for the three controls' accessible names ("Curve 2", "New curve"). */
  label: string;
}) {
  const names = uniqueNames(sources.map((d) => d.name));
  const ds = sources.find((d) => d.id === value.datasetId);
  const cols = ds ? uniqueNames(ds.data.labels.map((l, i) => l || `col ${i + 1}`)) : [];
  const dsOptions = [
    ...(ds ? [] : [{ value: "", label: "— choose a dataset —" }]),
    ...sources.map((d, i) => ({ value: d.id, label: names[i] })),
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <Select
        aria-label={`${label} dataset`}
        options={dsOptions}
        value={ds ? ds.id : ""}
        onChange={(e) => onChange({ datasetId: e.target.value, xKey: null, yKey: -1 })}
      />
      <Select
        aria-label={`${label} X`}
        disabled={!ds}
        options={[{ value: OWN_X, label: "X: its own X" }, ...cols.map((c, i) => ({ value: String(i), label: `X: ${c}` }))]}
        value={value.xKey === null ? OWN_X : String(value.xKey)}
        onChange={(e) => onChange({ ...value, xKey: e.target.value === OWN_X ? null : Number(e.target.value) })}
      />
      <Select
        aria-label={`${label} Y`}
        disabled={!ds}
        options={[
          ...(value.yKey < 0 || value.yKey >= cols.length ? [{ value: NO_Y, label: "Y: — choose —" }] : []),
          ...cols.map((c, i) => ({ value: String(i), label: `Y: ${c}` })),
        ]}
        value={value.yKey < 0 || value.yKey >= cols.length ? NO_Y : String(value.yKey)}
        onChange={(e) => onChange({ ...value, yKey: Number(e.target.value) })}
      />
    </div>
  );
}
