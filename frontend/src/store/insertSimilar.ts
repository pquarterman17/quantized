// Insert one column (a name, a formula or blank, a designation) into every similar sheet
// (lib/similarSheets.ts) as ONE undo step. It is all or nothing: if any sheet refuses, the sheets
// already written are undone and the status names the sheet and why, so the workbook never ends up
// with the column on some similar sheets and not others.

import type { OriginDesignation } from "../lib/columnmeta";
import { baseLabels } from "../lib/similarSheets";
import { setColumnDesignation } from "./columnDesignationActions";
import { useApp } from "./useApp";
import { insertColumn, setColumnHeader } from "./worksheetColumns";
import { historyMark, mergeHistorySince } from "./worksheetGrow";

export interface InsertSpec {
  name: string;
  /** A formula over the sheet's columns; empty inserts a blank data column. */
  expr: string;
  designation: OriginDesignation;
}

export type InsertOutcome = { ok: true; sheets: number; message: string } | { ok: false; error: string };

export function insertIntoSimilar(ids: readonly string[], spec: InsertSpec): InsertOutcome {
  const get = useApp.getState;
  const name = spec.name.trim();
  const expr = spec.expr.trim();
  const fail = (error: string): InsertOutcome => {
    get().setStatus(`Insert column: ${error}`, "danger");
    return { ok: false, error };
  };
  if (!name) return fail("give the column a name");
  if (ids.length === 0) return fail("pick at least one sheet");
  const sheets = ids.map((id) => get().datasets.find((d) => d.id === id));
  const missing = sheets.findIndex((d) => !d);
  if (missing >= 0) return fail("a chosen sheet no longer exists");
  const named = sheets.find((d) => d && (d.data.labels.includes(name) || d.data.metadata?.["x_column_name"] === name));
  if (named) return fail(`"${named.name}" already has a column named "${name}"`);

  const mark = historyMark();
  let done = 0;
  for (const id of ids) {
    const before = get().datasets.find((d) => d.id === id)!;
    const column = before.data.labels.length;
    if (expr) {
      if (!get().addFormula(id, name, expr)) return rollback(mark, done, `${before.name}: ${get().status || "the formula was refused"}`);
    } else {
      const at = insertColumn(id, baseLabels(before).length);
      if (at === null) return rollback(mark, done, `${before.name}: ${get().status || "the column was refused"}`);
      setColumnHeader(id, at, { label: name });
    }
    if (spec.designation !== "Y") setColumnDesignation(id, expr ? column : baseLabels(before).length, spec.designation);
    done++;
  }
  mergeHistorySince(mark, `insert column "${name}" into ${done} sheets`);
  const message = `inserted "${name}" ${expr ? `(= ${expr}) ` : "(blank) "}into ${done} similar sheet${done === 1 ? "" : "s"} — one Undo removes it from all`;
  get().setStatus(message);
  return { ok: true, sheets: done, message };

  function rollback(from: number, written: number, why: string): InsertOutcome {
    mergeHistorySince(from, "insert column");
    if (written > 0 || get().history.at(-1)?.seq !== from) get().undo();
    return fail(`${why}; nothing was changed`);
  }
}
