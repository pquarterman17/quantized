// Test fixture for the group-by pickers (acceptance pass 13 follow-through): the plain CSV
//
//   id,grp,sub,val
//   r1,A,x,1 ... r12,B,y,32
//
// as the importer leaves it. Only the FIRST text column (`id`) becomes a categorical channel;
// `grp` and `sub` stay in `metadata.text_columns`. Channels: 0 = val, 1 = id. The expected numbers in
// the tests come from pandas on this same CSV (`df.groupby("grp")["val"]` and so on).

import type { Dataset } from "../../lib/types";

export const GRP = ["A", "A", "A", "A", "A", "A", "B", "B", "B", "B", "B", "B"];
export const SUB = ["x", "x", "x", "y", "y", "y", "x", "x", "x", "y", "y", "y"];
export const VAL = [1, 2, 3, 10, 11, 12, 20, 21, 22, 30, 31, 32];

export const TEXT_GROUP_DS: Dataset = {
  id: "tg", name: "tg.csv",
  data: {
    time: VAL.map((_, i) => i + 1),
    values: VAL.map((v, i) => [v, i]),
    labels: ["val", "id"], units: ["", ""],
    cat_levels: { 1: VAL.map((_, i) => `r${i + 1}`) },
    metadata: { text_columns: { grp: GRP, sub: SUB } },
  },
};

/** Values of `val` per level of a text column, as `df.groupby(col)["val"].apply(list)` gives them. */
export const byLevel = (col: readonly string[]): Record<string, number[]> => {
  const out: Record<string, number[]> = {};
  col.forEach((level, i) => { (out[level] ??= []).push(VAL[i]); });
  return out;
};
