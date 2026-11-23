// Peak analyzer — "Batch" mode (audit P2.4 slice 4): pick a saved recipe and
// datasets, run the recipe over each (./usePeakBatch: client prepares, one
// job on the queue fits), watch n/N progress, cancel, then read / sort /
// export the uncertainty-diagnostic table (./PeakBatchTable) or add it to the
// library as a dataset — the standard derived-data path, so it saves with the
// workspace and names the recipe and every source in its metadata.

import { useMemo, useState } from "react";

import { INDEX_X, numericMetaFields, paramNamesOf, type SummaryXChoice } from "../../../lib/batchSummaryX";
import { csvBlob } from "../../../lib/csvCell";
import { saveBlob } from "../../../lib/download";
import type { PeakRecipe } from "../../../lib/peakwizard";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { Button, Select, StatusDot } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import SummaryXPicker from "../analysisselection/SummaryXPicker";
import { OutOfDateNote, WorkbenchProgress } from "../workbench/WorkbenchParts";
import PeakBatchTable from "./PeakBatchTable";
import { batchCsv, batchTableRows, nextSort, sortRows, type BatchSort } from "./peakBatchRows";
import { usePeakBatch } from "./usePeakBatch";
import ReopenBanner from "../resultcommit/ReopenBanner";
import { useReopenSeed } from "../resultcommit/useReopenSession";

const PHASE_LABEL: Record<string, string> = {
  preparing: "Preparing", fitting: "Fitting", cancelling: "Cancelling", done: "Done", cancelled: "Cancelled", failed: "Failed",
};
const faint = { color: "var(--text-faint)" } as const;

/** A recorded summary-X choice, or null when the record is not one. */
function recordedX(value: unknown): SummaryXChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { source, sort } = value as { source?: { kind?: unknown }; sort?: unknown };
  if (typeof sort !== "boolean" || !source || typeof source.kind !== "string") return null;
  return ["index", "name", "meta", "param"].includes(source.kind) ? (value as SummaryXChoice) : null;
}

export default function PeakBatchView({ recipes, current, pollMs }: {
  recipes: PeakRecipe[];
  /** The wizard's recipe name, preselected when it is a saved one. */
  current: string;
  /** Job poll interval (tests shorten it). */
  pollMs?: number;
}) {
  const b = usePeakBatch(recipes, current, pollMs);
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const rows = useMemo(() => (b.results ? batchTableRows(b.results) : []), [b.results]);
  // The sort lives here so the table and the CSV share one order.
  const [sort, setSort] = useState<BatchSort | null>(null);
  const shown = useMemo(() => (sort ? sortRows(rows, sort.key, sort.dir) : rows), [rows, sort]);
  const seedX = useReopenSeed("peak-batch", useApp((s) => s.activeId ?? undefined))?.settings["x"];
  const [xChoice, setXChoice] = useState<SummaryXChoice>(() => recordedX(seedX) ?? INDEX_X);
  const ranSets = useMemo(() => {
    const ids = new Set(b.results?.map((r) => r.datasetId) ?? []);
    return datasets.filter((d) => ids.has(d.id));
  }, [b.results, datasets]);
  const xFields = useMemo(() => numericMetaFields(ranSets), [ranSets]);
  const xParams = useMemo(() => paramNamesOf(ranSets), [ranSets]);
  const busy = b.phase === "preparing" || b.phase === "fitting" || b.phase === "cancelling";
  const ch = b.channels;

  const exportCsv = () => {
    if (!b.ran) return;
    const safe = b.ran.recipe.name.replace(/[^\w.-]+/g, "_") || "recipe";
    saveBlob(csvBlob(batchCsv(shown)), `peak-batch-${safe}.csv`);
  };
  const addTable = () => {
    const out = b.addAsTable(xChoice);
    if (out) toast(out.replaced ? "batch table replaced" : "batch table added to the library");
  };

  return (
    <div>
      <ReopenBanner tool="peak-batch" />
      <div className="qzk-field-lbl" style={{ marginTop: 0 }}>Recipe</div>
      {b.recipeNote && <div className="qzk-helptext" role="alert" style={{ color: "var(--warn)", marginBottom: 4 }}>{b.recipeNote}</div>}
      <Select
        aria-label="batch recipe"
        options={recipes.length
          ? [...(b.recipeName === "" ? [{ value: "", label: "— pick a saved recipe —" }] : []), ...recipes.map((r) => ({ value: r.name, label: r.name }))]
          : [{ value: "", label: "— no saved recipes —" }]}
        value={b.recipeName}
        disabled={busy}
        onChange={(e) => b.setRecipeName(e.target.value)}
      />
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
        {ch
          ? <>Fits <b>{ch.xLabel ?? "X"}</b> / <b>{ch.yLabel}</b> (the wizard&apos;s columns, matched by name in each dataset{ch.xLabel === null ? "; X is each dataset's own X column" : ""}).</>
          : "Select a dataset whose Y is plotted: the batch fits those columns."}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <span className="qzk-field-lbl" style={{ margin: 0, flex: 1 }}>
          Datasets ({b.picked.length} picked)
        </span>
        <Button size="sm" disabled={busy || selectedIds.length === 0} onClick={() => b.setPicked([...selectedIds])}>
          Library selection ({selectedIds.length})
        </Button>
        <Button size="sm" disabled={busy} onClick={() => b.setPicked(datasets.map((d) => d.id))}>All</Button>
        <Button size="sm" disabled={busy} onClick={() => b.setPicked([])}>None</Button>
      </div>
      <div role="group" aria-label="batch datasets" style={{ maxHeight: 140, overflow: "auto", marginTop: 4 }}>
        {datasets.map((d) => (
          <Checkbox key={d.id} checked={b.picked.includes(d.id)} disabled={busy} onChange={() => b.togglePicked(d.id)}>
            {d.name}
          </Checkbox>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <Button size="sm" variant="primary" disabled={busy || b.block !== null} title={b.block ?? undefined} onClick={() => void b.run()}>
          Run batch
        </Button>
        <Button size="sm" disabled={b.phase !== "preparing" && b.phase !== "fitting"} onClick={b.cancel}>
          Cancel
        </Button>
      </div>
      {b.phase !== "idle" && (
        <WorkbenchProgress
          label="batch progress"
          progress={{ done: b.done, total: b.total, phase: PHASE_LABEL[b.phase] }}
        />
      )}
      {b.block && !busy && <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>{b.block}</div>}
      {b.phase !== "idle" && (
        <div role="status" aria-label="batch status" style={{ marginTop: 6 }}>
          <StatusDot
            tone={b.phase === "done" ? "ok" : b.phase === "failed" ? "danger" : b.phase === "cancelled" ? "warn" : "accent"}
            label={<span>{b.phase} · {b.message}</span>}
          />
        </div>
      )}
      {b.error && <div style={{ color: "var(--danger)", marginTop: 4 }}>{b.error}</div>}

      {b.results && (
        <>
          <PeakBatchTable rows={shown} sort={sort} onSort={(key) => setSort((s) => nextSort(s, key))} />
          {b.stale ? (
            <OutOfDateNote block>a fitted dataset changed since this run. Run the batch again to export it or add it as a table.</OutOfDateNote>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button size="sm" onClick={exportCsv}>Export CSV</Button>
              <SummaryXPicker choice={xChoice} onChange={setXChoice} metaFields={xFields} params={xParams} />
              <Button size="sm" onClick={addTable}>Add as table</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
