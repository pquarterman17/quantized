// Reshape & combine workshop — the form (audit P2.5). Pure: the per-op
// fields, the workshop's seed from the command's selection, and the one
// translation from the form to the `TransformParams` that BOTH the preview and
// the commit run (lib/transformRun.computeTransform). No React, no store.

import { isCategoricalChannel } from "../../../lib/categorical";
import { originTextColumns } from "../../../lib/columnmeta";
import type { AppendMatch } from "../../../lib/mergeByName";
import type { TransformParams } from "../../../lib/transformRun";
import type { DataStruct } from "../../../lib/types";
import type { JoinKey, JoinMode } from "../../../lib/worksheetJoin";
import type { AggregateMode } from "../../../lib/worksheetTransforms";
import type { PreviewOp } from "../../../store/transformPreviewDialog";

export const OP_OPTIONS: { value: PreviewOp; label: string }[] = [
  { value: "merge", label: "Append rows (merge)" },
  { value: "join", label: "Join by key" },
  { value: "stack", label: "Stack columns (wide → long)" },
  { value: "unstack", label: "Unstack / pivot (long → wide)" },
  { value: "transpose", label: "Transpose" },
];

export interface TransformForm {
  op: PreviewOp;
  /** The primary input: the join's left side, the reshaped dataset. */
  primary: string;
  /** Append: every picked dataset, in order (the first is the primary). */
  appendIds: string[];
  match: AppendMatch;
  right: string;
  /** Join keys as option values (`keyOptions`). */
  leftKey: string;
  rightKey: string;
  mode: JoinMode;
  /** Stack: 0-based channels. */
  channels: number[];
  key: number;
  category: number;
  value: number;
  aggregate: AggregateMode;
}

interface Named {
  id: string;
  name: string;
  data: DataStruct;
}

/** The workshop's opening form: the seed's first id is the primary, a second
 *  seeded id the join partner, and every seeded id the append pick. */
export function seedForm(op: PreviewOp, seed: readonly string[], datasets: readonly Named[]): TransformForm {
  const ids = seed.filter((id) => datasets.some((d) => d.id === id));
  const primary = ids[0] ?? datasets[0]?.id ?? "";
  const data = datasets.find((d) => d.id === primary)?.data;
  const n = data?.labels.length ?? 0;
  return {
    op,
    primary,
    appendIds: ids.length ? ids : primary ? [primary] : [],
    match: "position",
    right: ids[1] ?? datasets.find((d) => d.id !== primary)?.id ?? "",
    leftKey: "-1",
    rightKey: "-1",
    mode: "inner",
    channels: Array.from({ length: n }, (_, i) => i),
    key: -1,
    category: Math.min(0, n - 1),
    value: Math.min(1, n - 1),
    aggregate: "mean",
  };
}

export interface KeyOption {
  value: string;
  label: string;
}

/** Join-key choices: X, every channel (a categorical one keys by its level
 *  text), and every text column. */
export function keyOptions(data: DataStruct | undefined): KeyOption[] {
  if (!data) return [];
  const xName = String(data.metadata?.x_column_name ?? "") || "X";
  return [
    { value: "-1", label: `${xName} (x)` },
    ...data.labels.map((label, i) => ({
      value: String(i),
      label: `${label || `column ${i + 1}`}${isCategoricalChannel(data, i) ? " (text levels)" : ""}`,
    })),
    ...originTextColumns(data).map((c) => ({ value: `t:${c.shortName}`, label: `${c.shortName} (text column)` })),
  ];
}

/** A key option value back to the `JoinKey` the join takes. */
export function parseKey(value: string): JoinKey {
  return value.startsWith("t:") ? value.slice(2) : Number.parseInt(value, 10);
}

export interface TransformRun {
  params: TransformParams;
  primaryId: string;
  /** The other inputs, in the order `params.with` names them. */
  otherIds: string[];
}

/** The form as a runnable transform, or the sentence saying what is missing. */
export function formToRun(form: TransformForm, datasets: readonly Named[]): TransformRun | string {
  const find = (id: string) => datasets.find((d) => d.id === id);
  const ref = (d: Named) => ({ id: d.id, name: d.name });
  if (form.op === "merge") {
    const picks = form.appendIds.flatMap((id) => find(id) ?? []);
    if (picks.length < 2) return "Tick at least two datasets to append.";
    const [first, ...rest] = picks;
    return {
      params: { op: "merge", with: rest.map(ref), ...(form.match === "name" ? { match: "name" as const } : {}) },
      primaryId: first.id,
      otherIds: rest.map((d) => d.id),
    };
  }
  const primary = find(form.primary);
  if (!primary) return "Pick a dataset.";
  const n = primary.data.labels.length;
  const inRange = (c: number) => Number.isInteger(c) && c >= -1 && c < n;
  switch (form.op) {
    case "join": {
      const right = find(form.right);
      if (!right) return "Pick a second dataset to join.";
      if (right.id === primary.id) return "Pick two different datasets to join.";
      return {
        params: { op: "join", leftKey: parseKey(form.leftKey), rightKey: parseKey(form.rightKey), mode: form.mode, with: ref(right) },
        primaryId: primary.id,
        otherIds: [right.id],
      };
    }
    case "stack": {
      const channels = form.channels.filter((c) => c >= 0 && c < n);
      if (!channels.length) return "Tick at least one column to stack.";
      return { params: { op: "stack", channels }, primaryId: primary.id, otherIds: [] };
    }
    case "unstack":
      if (![form.key, form.category, form.value].every(inRange)) return "Pick the row key, category and value columns.";
      return {
        params: { op: "unstack", key: form.key, category: form.category, value: form.value, aggregate: form.aggregate },
        primaryId: primary.id,
        otherIds: [],
      };
    default:
      return { params: { op: "transpose" }, primaryId: primary.id, otherIds: [] };
  }
}
