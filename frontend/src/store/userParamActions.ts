// Worksheet user-parameter header rows (lib/userParams.ts) — the store half:
// set / clear one column's value, remove a parameter, and the two uses a
// parameter has outside the header: legend labels from a template and curve
// order by a numeric parameter. Each command is one undo step with a status
// line, and loaded only with the worksheet pane's lazy chunk. A parameter is
// a `metadata.label_rows` row, so every writer routes through the
// pending-book guard (`resolvePendingEdit`) like the other data writers.

import { editRefusalNotice, isRederived } from "../lib/rederived";
import { effectiveChannels } from "../lib/plotdata";
import { analysisData } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import { expandParamTemplate, orderColumnsByParam, userParamRows, withParamCell, withoutParam } from "../lib/userParams";
import { resolvePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";

const get = useApp.getState;

function editable(id: string): Dataset | null {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return null;
  if (isRederived(ds)) {
    get().setStatus(editRefusalNotice(ds));
    return null;
  }
  return ds;
}

/** The dataset with `label_rows` replaced (the callers hold the pending-book guard). */
function withRows(d: Dataset, rows: unknown[]): Dataset {
  return { ...d, data: { ...d.data, metadata: { ...d.data.metadata, label_rows: rows } } };
}

/** Set (a blank value clears) parameter `name` on value column `col`. The
 *  parameter row is created on first use. */
export function setUserParam(id: string, name: string, col: number, text: string): void {
  const ds = editable(id);
  if (!ds || resolvePendingEdit(get, ds, "editing a column parameter", () => setUserParam(id, name, col, text))) return;
  const key = name.trim();
  if (!key || col < 0 || col >= ds.data.labels.length) return;
  const before = userParamRows(ds.data).find((r) => r.name === key)?.cells[col]?.trim() ?? "";
  if (before === text.trim()) return;
  get().recordHistory("edit column parameter");
  const rows = withParamCell(ds.data.metadata, key, col, text, ds.data.labels.length);
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? withRows(d, rows) : d)) }));
  get().touchDataset(id);
  get().setStatus(`set ${key} of "${ds.data.labels[col]}"${text.trim() ? ` to ${text.trim()}` : " (cleared)"}`);
}

/** Remove parameter `name` from every column. */
export function removeUserParam(id: string, name: string): void {
  const ds = editable(id);
  if (!ds || resolvePendingEdit(get, ds, "removing a column parameter", () => removeUserParam(id, name))) return;
  if (!userParamRows(ds.data).some((r) => r.name === name)) return;
  get().recordHistory("remove column parameter");
  const rows = withoutParam(ds.data.metadata, name);
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? withRows(d, rows) : d)) }));
  get().touchDataset(id);
  get().setStatus(`removed the parameter "${name}"`);
}

/** Legend labels for `cols` from a template (`{Name}` = the column's value of
 *  parameter Name; `{label}` / `{unit}` / `{comment}`), written as ordinary
 *  per-channel legend overrides — one undo step, undoable and saved like a
 *  hand rename. A column the template cannot fill (a missing value) keeps its
 *  current label and is reported; nothing is written when no column can be
 *  filled. Returns the number of labels written. */
export function applyParamLegendTemplate(id: string, cols: readonly number[], template: string): number {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds || !template.trim()) return 0;
  const labels: Record<number, string> = {};
  const skipped: string[] = [];
  let firstError = "";
  for (const c of cols) {
    if (c < 0 || c >= ds.data.labels.length) continue;
    const comment = ds.columnProps?.[c]?.comment ?? "";
    const out = expandParamTemplate(template, ds.data, c, comment);
    if ("error" in out) {
      skipped.push(ds.data.labels[c]);
      firstError ||= out.error;
    } else labels[c] = out.text;
  }
  const n = Object.keys(labels).length;
  if (n === 0) {
    get().setStatus(`legend template not applied — ${firstError || "no column selected"}`);
    return 0;
  }
  get().recordHistory("legend labels from parameters");
  useApp.setState((s) => ({ seriesLabels: { ...s.seriesLabels, ...labels } }));
  get().setStatus(
    `legend labels set on ${n} column${n === 1 ? "" : "s"}` +
      (skipped.length ? `; kept ${skipped.length} unchanged (${firstError}: ${skipped.slice(0, 3).join(", ")})` : ""),
  );
  return n;
}

/** Status line for the order dialog when the sheet has no parameter yet. */
export function noUserParamsNotice(): void {
  get().setStatus("no user parameters yet — add one in the column header editor (Shift+F2)");
}

/** Order the plotted curves by the numeric value of parameter `name`
 *  (ascending / descending). Only the currently plotted channels among `cols`
 *  (all plotted ones when `cols` is empty) are reordered; a curve with a blank
 *  or non-numeric value follows the numeric ones in its current order. Returns
 *  false when no plotted curve has a numeric value. */
export function orderCurvesByParam(id: string, name: string, dir: 1 | -1, cols: readonly number[] = []): boolean {
  const ds = get().datasets.find((d) => d.id === id);
  const data = analysisData(ds);
  if (!ds || !data) return false;
  const s = get();
  const plotted = effectiveChannels(data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder);
  const subset = cols.length ? plotted.filter((c) => cols.includes(c)) : plotted;
  const { order, unordered } = orderColumnsByParam(ds.data, name, subset, dir);
  if (unordered === subset.length) {
    get().setStatus(`curves not reordered — no plotted column has a numeric "${name}"`);
    return false;
  }
  const rest = plotted.filter((c) => !subset.includes(c));
  get().setSeriesOrder([...order, ...rest]);
  get().setStatus(
    `ordered ${subset.length} curves by ${name} (${dir === 1 ? "ascending" : "descending"})` +
      (unordered ? `; ${unordered} without a numeric value kept last` : ""),
  );
  return true;
}
