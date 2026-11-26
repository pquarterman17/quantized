// Text to columns, committed: the split of one text column becomes a NEW
// worksheet through the shared result contract (store/commitComputedOutput.ts),
// the same route Frequency count takes (store/worksheetStatsRun.ts):
// - the source worksheet is never edited (raw data is not overwritten);
// - ONE undo step removes the worksheet and its Library result together;
// - a repeat of the same split finds the existing output and adds nothing;
// - the output goes out of date when the source changes.
// The rows split are the ANALYSIS rows (exclusions and the row filter applied),
// like every other worksheet-derived output.

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { originTextColumns } from "../lib/originTextColumns";
import { analysisData } from "../lib/rowstate";
import { textToColumnsData, type SplitOptions } from "../lib/textToColumns";
import { toast } from "./toasts";
import { useApp } from "./useApp";

export const TEXT_TO_COLUMNS_PRODUCER = { id: "text-to-columns", label: "Text to columns", version: 1 } as const;

export type TextToColumnsOutcome = { ok: true; created: number; existing: boolean } | { ok: false; error: string };

export async function runTextToColumns(datasetId: string, textName: string, o: SplitOptions): Promise<TextToColumnsOutcome> {
  const fail = (error: string): TextToColumnsOutcome => {
    useApp.getState().setStatus(`Text to columns: ${error}`, "danger");
    return { ok: false, error };
  };
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds) return fail("select a worksheet first");
  if (ds.pending) return fail("wait for the full worksheet to load");
  const rows = analysisData(ds) ?? ds.data;
  const col = originTextColumns(rows).find((t) => t.shortName === textName);
  if (!col) return fail(`the text column "${textName}" is no longer in this worksheet`);
  const textKey = rows.metadata?.["text_columns"] ? "text_columns" : "origin_text_columns";
  const label = col.longName ?? col.shortName;
  let built;
  try {
    built = textToColumnsData(rows, col.rows, textName, label, textKey, o);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "the split failed");
  }
  const name = `${ds.name} — ${label} split`;
  const { commitComputedOutput } = await import("./commitComputedOutput");
  const outcome = commitComputedOutput({
    producer: TEXT_TO_COLUMNS_PRODUCER,
    sources: [{ id: ds.id, computedOn: analysisDataFingerprint(ds) }],
    settings: { column: textName, delimiter: o.delimiter, custom: o.custom ?? null, quote: o.quote !== false, trim: o.trim !== false, merge: o.merge === true },
    name,
    data: built.data,
    patch: { ...(ds.workbookId ? { workbookId: ds.workbookId } : {}), ...(ds.folderId ? { folderId: ds.folderId } : {}) },
    status: `created "${name}" — ${built.created} column${built.created === 1 ? "" : "s"} from "${label}"; "${ds.name}" is unchanged`,
  });
  if (outcome.kind === "refused") return fail(outcome.reason);
  if (outcome.kind === "existing") {
    toast("this split is already in the Library; nothing was duplicated", "info");
    return { ok: true, created: built.created, existing: true };
  }
  return { ok: true, created: built.created, existing: false };
}
