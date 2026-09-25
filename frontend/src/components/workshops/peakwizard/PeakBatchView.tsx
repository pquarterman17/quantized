// Peak Analyzer — "Batch" mode (audit P2.4 slice 4): pick a saved recipe and
// datasets, run the recipe over each (./usePeakBatch: client prepares, one
// job on the queue fits), watch n/N progress, cancel, then read / sort /
// export the uncertainty-diagnostic table (./PeakBatchTable) or add it to the
// library as a dataset — the standard derived-data path, so it saves with the
// workspace and names the recipe and every source in its metadata.

import { useMemo } from "react";

import { saveBlob } from "../../../lib/download";
import type { PeakRecipe } from "../../../lib/peakwizard";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { Button, Select, StatusDot } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import PeakBatchTable from "./PeakBatchTable";
import { batchCsv, batchTableRows } from "./peakBatchTable";
import { usePeakBatch } from "./usePeakBatch";

const faint = { color: "var(--text-faint)" } as const;

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
  const busy = b.phase === "preparing" || b.phase === "fitting" || b.phase === "cancelling";
  const ch = b.channels;

  const exportCsv = () => {
    if (!b.ran) return;
    const safe = b.ran.recipe.name.replace(/[^\w.-]+/g, "_") || "recipe";
    saveBlob(new Blob([batchCsv(rows)], { type: "text/csv" }), `peak-batch-${safe}.csv`);
  };
  const addTable = () => {
    const id = b.addAsTable();
    if (id) toast("batch table added to the library");
  };

  return (
    <div>
      <div className="qzk-field-lbl" style={{ marginTop: 0 }}>Recipe</div>
      <Select
        aria-label="batch recipe"
        options={recipes.length
          ? recipes.map((r) => ({ value: r.name, label: r.name }))
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
        {b.phase !== "idle" && (
          <span aria-label="batch progress" className="qzk-ds-meta" style={{ margin: 0, fontFamily: "var(--font-mono)" }}>
            {b.done}/{b.total}
          </span>
        )}
      </div>
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
          <PeakBatchTable rows={rows} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button size="sm" onClick={exportCsv}>Export CSV</Button>
            <Button size="sm" onClick={addTable}>Add as table</Button>
          </div>
        </>
      )}
    </div>
  );
}
