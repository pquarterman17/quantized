// Worksheet conditional formatting commands: set or clear the rules of one or
// more value columns, ONE undo step with a status line. View-only (like
// store/worksheetColumnView.ts): the data, plots and formulas never change, so
// there is no `touchDataset`; only `Dataset.cellRules` moves. Loaded with the
// worksheet pane (a lazy chunk).

import { sanitizeRuleList, type CellRule } from "../lib/worksheetRulesModel";
import { useApp } from "./useApp";

const get = useApp.getState;

/** Say why a rule form was not applied (the status line). */
export function refuseRules(message: string): void {
  get().setStatus(message);
}

/** Give `cols` exactly `rules` (copied, sanitized); `null` or an empty list
 *  clears them. Out-of-range columns are skipped; a no-op is not an undo step.
 *  Returns how many columns changed. */
export function setColumnRules(id: string, cols: readonly number[], rules: readonly CellRule[] | null): number {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return 0;
  const clean = rules ? sanitizeRuleList(structuredClone(rules)) : undefined;
  const targets = [...new Set(cols)].filter((c) => Number.isInteger(c) && c >= 0 && c < ds.data.labels.length);
  const next = { ...(ds.cellRules ?? {}) };
  let changed = 0;
  for (const c of targets) {
    if (JSON.stringify(next[c]) === JSON.stringify(clean)) continue;
    if (clean) next[c] = structuredClone(clean);
    else delete next[c];
    changed++;
  }
  if (!changed) return 0;
  const cellRules = Object.keys(next).length ? next : undefined;
  get().recordHistory(clean ? "conditional format" : "clear conditional format");
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? { ...d, cellRules } : d)) }));
  const n = `${changed} column${changed === 1 ? "" : "s"}`;
  get().setStatus(clean ? `formatted ${n} — display only, the data is unchanged` : `cleared the formatting of ${n}`);
  return changed;
}
