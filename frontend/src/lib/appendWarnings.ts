// Append warnings (audit P2.5 — "warnings for ... unit mismatch"), split out
// of lib/transformWarnings.ts when append gained its match-by-NAME mode
// (lib/mergeByName.ts). Same contract as every analyzer there: it takes the
// SAME inputs `mergeDatasets` takes and says, before anything is created,
// what the append will do to the data.

import { alignColumnsByName, type AppendMatch } from "./mergeByName";
import { sidecarRowCount } from "./rowSidecars";
import { columnName, columnUnitOf, unitsConflict, type TransformWarning } from "./transformWarnings";
import type { DataStruct } from "./types";

/** Warnings for `mergeDatasets(datasets, names, match)`.
 *
 *  By POSITION (the default): column k of every input lands in column k of
 *  the result under the FIRST input's name and unit. A differing unit is a
 *  real mismatch; a differing name is the tell that positions may not line up.
 *
 *  By NAME (lib/mergeByName.ts): same-named columns are compared for units,
 *  and every column an input lacks is reported — its rows are NaN there. */
export function analyzeMerge(
  datasets: readonly DataStruct[],
  names: readonly string[],
  match: AppendMatch = "position",
): TransformWarning[] {
  const out: TransformWarning[] = [];
  if (datasets.length < 2) return out;
  const first = datasets[0];
  const unitNotes: string[] = [];
  const unitCols = new Set<string>();
  const labelNotes: string[] = [];
  const labelCols = new Set<string>();
  const xUnit = columnUnitOf(first, -1);
  for (let i = 1; i < datasets.length; i += 1) {
    const dx = columnUnitOf(datasets[i], -1);
    if (unitsConflict(xUnit, dx)) {
      unitNotes.push(`X is ${xUnit} in ${names[0]} but ${dx} in ${names[i]}`);
      unitCols.add(columnName(first, -1));
    }
  }
  if (match === "name") {
    const a = alignColumnsByName(datasets);
    a.labels.forEach((label, c) => {
      const held = datasets.flatMap((d, i) => (a.cols[i][c] >= 0 ? [{ i, unit: columnUnitOf(d, a.cols[i][c]) }] : []));
      const ref = held.find((h) => h.unit);
      for (const h of held) {
        if (ref && unitsConflict(ref.unit, h.unit)) {
          unitNotes.push(`"${label}" is ${ref.unit} in ${names[ref.i]} but ${h.unit} in ${names[h.i]}`);
          unitCols.add(label);
        }
      }
    });
    datasets.forEach((d, i) => {
      const missing = a.labels.filter((_, c) => a.cols[i][c] < 0);
      if (!missing.length) return;
      // The SAME row count `mergeDatasets` (lib/merge.ts) pads this input to
      // — `sidecarRowCount`, not the bare numeric grid — so a text-only or
      // sidecar-padded part's row count is not under-reported here (review
      // finding 4).
      const rows = sidecarRowCount(d.metadata, Math.max(d.time.length, d.values.length));
      out.push({
        code: "missing-columns",
        text: `${names[i]} has no ${missing.map((m) => `"${m}"`).join(", ")} column${missing.length === 1 ? "" : "s"}; ${rows === 1 ? "its row is" : `its ${rows} rows are`} left blank (NaN) there.`,
        count: missing.length,
        columns: missing,
      });
    });
  } else {
    for (let i = 1; i < datasets.length; i += 1) {
      const d = datasets[i];
      const n = Math.min(first.labels.length, d.labels.length);
      for (let c = 0; c < n; c += 1) {
        const ua = columnUnitOf(first, c);
        const ub = columnUnitOf(d, c);
        const col = columnName(first, c);
        if (unitsConflict(ua, ub)) {
          unitNotes.push(`"${col}" is ${ua} in ${names[0]} but ${ub} in ${names[i]}`);
          unitCols.add(col);
        }
        const la = (first.labels[c] ?? "").trim();
        const lb = (d.labels[c] ?? "").trim();
        if (la && lb && la.toLowerCase() !== lb.toLowerCase()) {
          labelNotes.push(`column ${c + 1} is "${la}" in ${names[0]} but "${lb}" in ${names[i]}`);
          labelCols.add(col);
        }
      }
    }
  }
  if (unitNotes.length) {
    out.unshift({
      code: "unit-mismatch",
      text: match === "name"
        ? `Units differ between same-named columns: ${unitNotes.join("; ")}. Rows are appended by name and keep the first recorded unit.`
        : `Units differ at the same column position: ${unitNotes.join("; ")}. Rows are appended by position and keep ${names[0]}'s units.`,
      count: unitNotes.length,
      columns: [...unitCols],
      confirm: true,
    });
  }
  if (labelNotes.length) {
    out.push({
      code: "label-mismatch",
      text: `Column names differ at the same position: ${labelNotes.join("; ")}. Rows are appended by position and keep ${names[0]}'s names.`,
      count: labelNotes.length,
      columns: [...labelCols],
    });
  }
  return out;
}
