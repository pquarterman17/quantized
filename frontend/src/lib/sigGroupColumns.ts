// The columns a worksheet can offer as "group A" / "group B" of a p-value table
// (plan item 47, W1): a categorical channel, or any text column of the
// `metadata.text_columns` sidecar. A CSV import makes only its FIRST text column
// categorical, so a pair table (text A, text B, numeric p) needs both kinds.
//
// A column is named by one integer, like every other column of `SigMarks`:
// `>= 0` is a channel, `-1` is "not picked", `<= -2` is the (-2 - k)-th text
// column in `textColumnEntries` order (the key convention of lib/fitModelText).

import { categoryLevels, isCategoricalChannel } from "./categorical";
import { resolveCategoryLabels } from "./barlayout";
import { textColumnEntries } from "./originTextColumnCells";
import type { DataStruct } from "./types";

export interface GroupColumn { key: number; label: string }

export const isTextKey = (key: number): boolean => key <= -2;
const textIndex = (key: number): number => -2 - key;

/** Every column that can hold group names, in the order the sheet shows them. */
export function groupColumns(d: DataStruct): GroupColumn[] {
  const channels = d.labels.flatMap((label, key) => (isCategoricalChannel(d, key) ? [{ key, label }] : []));
  return [...channels, ...textColumnEntries(d).map(([label], k) => ({ key: -2 - k, label }))];
}

/** A reader of one group column: its display name, and the group name at each row
 *  (undefined when blank). `ids` maps the analysis view's rows to source rows. */
export function groupReader(
  all: DataStruct, view: DataStruct, ids: readonly number[] | null, key: number,
): { label: string; at: (i: number) => string | undefined } | { error: string } {
  if (!isTextKey(key)) {
    if (key < 0 || key >= view.labels.length) return { error: "column is missing; pick the columns again" };
    if (!isCategoricalChannel(view, key)) return { error: `column "${view.labels[key]}" must be a text column of group names` };
    const levels = categoryLevels(view, key);
    const names = resolveCategoryLabels(view, key, levels);
    return { label: view.labels[key], at: (i) => names[levels.indexOf(view.values[i][key])] };
  }
  const entry = textColumnEntries(all)[textIndex(key)];
  if (!entry) return { error: "a group column no longer exists; pick the columns again" };
  const [label, cells] = entry;
  if (cells.length !== all.values.length) return { error: `text column "${label}" does not line up with the sheet's rows` };
  return {
    label,
    at: (i) => {
      const text = String(cells[ids ? ids[i] : i] ?? "").trim();
      return text === "" ? undefined : text;
    },
  };
}
