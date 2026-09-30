// Batch integrate (ORIGIN_GAP_PLAN #35's UI) — a ToolWindow opened from the
// Peaks panel: pick datasets and integration windows, integrate the plotted Y
// of every dataset over every window in one /api/peaks/integrate-batch call,
// then read / export the dataset x window table or add the trend (integrated
// intensity vs a metadata field) to the library as a dataset. Loaded lazily
// from PeaksPanel; all state is ./useBatchIntegrate, every rule ./batchIntegrate.

import { Checkbox } from "../../primitives/Checkbox";
import { Button, Select, StatusDot } from "../../primitives";
import ToolWindow from "../../overlays/ToolWindow";
import BatchIntegrateResults from "./BatchIntegrateResults";
import BatchWindowsEditor from "./BatchWindowsEditor";
import { useBatchIntegrate } from "./useBatchIntegrate";

const faint = { color: "var(--text-faint)" } as const;

export default function BatchIntegrateWindow({ seedPeaks, onClose }: {
  /** The Peaks panel's peaks (fitted when present, else detected). */
  seedPeaks: readonly { center: number; fwhm: number }[];
  onClose: () => void;
}) {
  const b = useBatchIntegrate(seedPeaks);
  const ch = b.channels;

  return (
    <ToolWindow id="peaks-batch-integrate" title="Batch integrate" width={480} onClose={onClose}>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 0 }}>
        {ch
          ? <>Integrates <b>{ch.yLabel}</b> vs <b>{ch.xLabel ?? "X"}</b>, matched by column name in each dataset.</>
          : "Select a dataset whose Y is plotted: the batch integrates that column."}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <span className="qzk-field-lbl" style={{ margin: 0, flex: 1 }}>Datasets ({b.picked.length} picked)</span>
        <Button size="sm" disabled={b.busy || b.selectedIds.length === 0} onClick={() => b.setPicked([...b.selectedIds])}>
          Library selection ({b.selectedIds.length})
        </Button>
        <Button size="sm" disabled={b.busy} onClick={() => b.setPicked(b.datasets.map((d) => d.id))}>All</Button>
        <Button size="sm" disabled={b.busy} onClick={() => b.setPicked([])}>None</Button>
      </div>
      <div role="group" aria-label="batch integrate datasets" style={{ maxHeight: 120, overflow: "auto", marginTop: 4 }}>
        {b.datasets.map((d) => (
          <Checkbox key={d.id} checked={b.picked.includes(d.id)} disabled={b.busy} onChange={() => b.togglePicked(d.id)}>
            {d.name}
          </Checkbox>
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        <BatchWindowsEditor windows={b.windows} onChange={b.setWindows} seed={b.seedWindows} roi={b.roi} disabled={b.busy} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Baseline</span>
        <Select
          aria-label="batch baseline"
          options={[{ value: "linear", label: "Linear (window ends)" }, { value: "none", label: "None" }]}
          value={b.baseline}
          disabled={b.busy}
          onChange={(e) => b.setBaseline(e.target.value === "none" ? "none" : "linear")}
        />
        <Checkbox checked={b.align} disabled={b.busy} onChange={b.setAlign}
          title="Shifts each dataset onto the first by cross-correlation; needs one shared x grid.">
          Align to first
        </Checkbox>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <Button size="sm" variant="primary" disabled={b.busy || b.block !== null} title={b.block ?? undefined}
          onClick={() => void b.start()}>
          {b.busy ? "Integrating…" : "Integrate"}
        </Button>
        {b.phase !== "idle" && (
          <div role="status" aria-label="batch integrate status">
            <StatusDot
              tone={b.phase === "done" ? "ok" : b.phase === "failed" ? "danger" : "accent"}
              label={b.phase === "done" ? `${b.rows?.filter((r) => r.status === "ok").length ?? 0}/${b.rows?.length ?? 0} ok` : b.phase}
            />
          </div>
        )}
      </div>
      {b.block && !b.busy && <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>{b.block}</div>}
      {b.error && <div style={{ color: "var(--danger)", marginTop: 4 }}>{b.error}</div>}

      <BatchIntegrateResults b={b} />
    </ToolWindow>
  );
}
