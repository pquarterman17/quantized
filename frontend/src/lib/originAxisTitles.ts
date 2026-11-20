// Origin's auto axis-title codes (`%(?X)`, `%(?Y)`, `%(?Y, @LC)`, ...)
// substituted from the layer's own curve columns, the way Origin draws them
// (A6 of the visual sweep: Catchment *.opju Graph6 showed the raw `%(?X)` /
// `%(?Y)` where Origin shows "Year" / "ΔS").
//
// Origin's substitution notation: `%(?X)` / `%(?Y)` name the X / Y dataset of
// the layer's FIRST plot; with no `@` option the text is the column's Long
// Name (its Short Name when it has none) followed by its Units in
// parentheses. `@LL` is the Long Name alone, `@LU` the Units, `@LC` the
// Comments, `@C` the Short Name. Every other option (or a column that did
// not import) stays unresolved, and a title still holding a code is no title
// at all ("" -> the plot's data-derived label), never a guess.
//
// LAZY: only the Origin apply body (`store/originApplyRun.ts`) imports this.

import type { OriginFigureEntry } from "./originFigures";
import type { Dataset, OriginFigure } from "./types";

const AUTO_CODE = /%\(\?([XY])\s*(?:,\s*@([A-Za-z]+)\s*)?\)/g;
const ANY_CODE = /[%$]\(/;

interface ColumnText {
  short: string;
  long: string;
  unit: string;
  comment: string;
}

/** `DataStruct` dedupes repeated labels as "Name (2)"; Origin's Long Name is
 *  the undeduplicated one. Strip the suffix only when it IS a dedupe (an
 *  earlier label carries the bare name). */
function undeduped(labels: readonly string[], idx: number): string {
  const label = labels[idx] ?? "";
  const m = /^(.*) \((\d+)\)$/.exec(label);
  return m && labels.slice(0, idx).includes(m[1]) ? m[1] : label;
}

function columnText(ds: Dataset, letter: string): ColumnText | null {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const comments = (meta.column_comments ?? {}) as Record<string, unknown>;
  const comment = String(comments[letter] ?? "");
  const xLetter = String(meta.x_column_name ?? "");
  if (letter === "" || (xLetter !== "" && letter === xLetter)) {
    if (xLetter === "") return null; // a synthetic row index: no Origin column to name
    return { short: xLetter, long: String(meta.x_column_long ?? ""), unit: String(meta.x_column_unit ?? ""), comment };
  }
  const letters = Array.isArray(meta.origin_column_names) ? (meta.origin_column_names as unknown[]).map(String) : [];
  const idx = letters.indexOf(letter);
  if (idx >= 0) {
    const long = undeduped(ds.data.labels, idx);
    return { short: letter, long: long === letter ? "" : long, unit: ds.data.units[idx] ?? "", comment };
  }
  const text = (meta.origin_text_column_labels ?? {}) as Record<string, { long_name?: unknown; unit?: unknown }>;
  const t = text[letter];
  if (t && typeof t === "object") {
    return { short: letter, long: String(t.long_name ?? ""), unit: String(t.unit ?? ""), comment };
  }
  return null;
}

function substitute(col: ColumnText, option: string | undefined): string | null {
  switch ((option ?? "").toUpperCase()) {
    case "":
      return `${col.long || col.short}${col.unit ? ` (${col.unit})` : ""}`;
    case "LL":
      return col.long || null;
    case "LU":
      return col.unit || null;
    case "LC":
      return col.comment || null;
    case "C":
      return col.short;
    default:
      return null; // an option not decoded here: never guessed
  }
}

/** `title` with each auto code resolved against `figure`'s first curve whose
 *  book is among `datasets`; "" when any code is left unresolved. A title
 *  with no code at all is returned unchanged. */
export function resolveAxisTitleCodes(title: string, figure: OriginFigure, datasets: readonly Dataset[]): string {
  if (!ANY_CODE.test(title)) return title;
  const bookOf = (d: Dataset) => String((d.data.metadata ?? {}).origin_book ?? "");
  const first = (figure.curves ?? []).find((c) => datasets.some((d) => bookOf(d) === c.book));
  const ds = first ? datasets.find((d) => bookOf(d) === first.book) : undefined;
  const out = title
    .replace(AUTO_CODE, (raw, axis: string, option: string | undefined) => {
      if (!first || !ds) return raw;
      const col = columnText(ds, axis === "X" ? (first.x ?? "") : first.y);
      return (col && substitute(col, option)) ?? raw;
    })
    .trim();
  return ANY_CODE.test(out) ? "" : out;
}

/** `entry` with its figure's axis titles resolved (`resolveAxisTitleCodes`). */
export function withResolvedAxisTitles(entry: OriginFigureEntry, datasets: readonly Dataset[]): OriginFigureEntry {
  const f = entry.figure;
  const fields = ["x_title", "y_title", "y2_title"] as const;
  if (!fields.some((k) => ANY_CODE.test(f[k] ?? ""))) return entry;
  const figure = { ...f };
  for (const k of fields) {
    const t = f[k];
    if (t) figure[k] = resolveAxisTitleCodes(t, f, datasets);
  }
  return { ...entry, figure };
}
