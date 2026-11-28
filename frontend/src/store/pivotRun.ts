// Time-series pivot, committed: the reshape becomes a NEW worksheet through the shared result
// contract (store/commitComputedOutput.ts), exactly as Text to columns does. The source is never
// edited; one undo step removes the output together with its Library result; the same reshape twice
// finds the existing output; the output is marked out of date when the source changes (per the
// recalc mode). The rows used are the ANALYSIS rows (exclusions and the row filter applied).

import { lit } from "../lib/macro";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { buildLong, buildWide, columnNameOf, type PivotSpec } from "../lib/pivotSheet";
import { analysisData } from "../lib/rowstate";
import type { DataStruct, Dataset } from "../lib/types";
import { commitComputedOutput } from "./commitComputedOutput";
import { toast } from "./toasts";
import { useApp } from "./useApp";

export const PIVOT_PRODUCER = { id: "time-series-pivot", label: "Time-series pivot", version: 1 } as const;
export const UNPIVOT_PRODUCER = { id: "time-series-unpivot", label: "Stack columns", version: 1 } as const;

export type PivotOutcome = { ok: true; message: string; existing: boolean } | { ok: false; error: string };

function fail(label: string, error: string): PivotOutcome {
  useApp.getState().setStatus(`${label}: ${error}`, "danger");
  return { ok: false, error };
}

function source(datasetId: string): { ds: Dataset; rows: DataStruct } | { error: string } {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds) return { error: "select a worksheet first" };
  if (ds.pending) return { error: "wait for the full worksheet to load" };
  const rows = analysisData(ds);
  return rows ? { ds, rows } : { error: "the worksheet has no rows to use" };
}

function finish(label: string, committed: ReturnType<typeof commitComputedOutput>, message: string): PivotOutcome {
  if (committed.kind === "refused") return fail(label, committed.reason);
  if (committed.kind === "existing") {
    toast("this reshape is already in the Library; nothing was duplicated", "info");
    return { ok: true, message, existing: true };
  }
  return { ok: true, message, existing: false };
}

const patchOf = (ds: Dataset): Partial<Dataset> => ({ ...(ds.workbookId ? { workbookId: ds.workbookId } : {}), ...(ds.folderId ? { folderId: ds.folderId } : {}) });

/** Long to wide: a new worksheet with one row per time and one column per key. */
export function runPivot(datasetId: string, spec: PivotSpec): PivotOutcome {
  const src = source(datasetId);
  if ("error" in src) return fail("Pivot", src.error);
  const built = buildWide(src.rows, spec);
  if ("error" in built) return fail("Pivot", built.error);
  const { ds } = src;
  const name = `${ds.name} (pivot)`;
  const skipped = built.skipped ? `; ${built.skipped} row${built.skipped === 1 ? "" : "s"} without a time or key left out` : "";
  const merged = built.merged ? `; ${built.merged} repeated time/key cell${built.merged === 1 ? "" : "s"} combined by ${spec.rule}` : "";
  const message = `created "${name}": ${built.data.time.length} times x ${built.data.labels.length} keys, empty cells missing${skipped}${merged}; "${ds.name}" is unchanged`;
  const committed = commitComputedOutput({
    producer: PIVOT_PRODUCER,
    sources: [{ id: ds.id, computedOn: analysisDataFingerprint(ds) }],
    settings: { time: spec.time, key: "text" in spec.key ? spec.key.text : spec.key.channel, value: spec.value, rule: spec.rule },
    name,
    data: built.data,
    patch: patchOf(ds),
    status: message,
  });
  if (committed.kind !== "refused") useApp.getState().recordMacro(`Pivot ${ds.name} (long to wide, ${spec.rule})`, `qz.pivot(${lit(ds.name)}, ${lit(spec)})`);
  return finish("Pivot", committed, message);
}

/** Wide to long: a new worksheet stacking the chosen columns under a key column. */
export function runUnpivot(datasetId: string, columns: readonly number[], skipEmpty: boolean): PivotOutcome {
  const src = source(datasetId);
  if ("error" in src) return fail("Stack columns", src.error);
  const { ds, rows } = src;
  const built = buildLong(rows, columns, skipEmpty, "value");
  if ("error" in built) return fail("Stack columns", built.error);
  const name = `${ds.name} (stacked)`;
  const message = `created "${name}": ${built.data.time.length} rows from ${columns.length} column${columns.length === 1 ? "" : "s"} (${columns.map((c) => columnNameOf(rows, c)).join(", ")}); "${ds.name}" is unchanged`;
  const committed = commitComputedOutput({
    producer: UNPIVOT_PRODUCER,
    sources: [{ id: ds.id, computedOn: analysisDataFingerprint(ds) }],
    settings: { columns: [...columns], skipEmpty },
    name,
    data: built.data,
    patch: patchOf(ds),
    status: message,
  });
  if (committed.kind !== "refused") {
    useApp.getState().recordMacro(`Stack columns of ${ds.name} (wide to long)`, `qz.unpivot(${lit(ds.name)}, ${lit({ columns, skipEmpty })})`);
  }
  return finish("Stack columns", committed, message);
}
