// Resample / align workshop — view (audit P2.5). Pick one or more datasets
// and a target grid; the backend resamples each one LIVE and the panel shows
// the source-vs-resampled overlay, the row counts and every warning before
// "Create" adds anything. Thin — the logic lives in useResample.

import ToolWindow from "../../overlays/ToolWindow";
import TransformWarningList from "../../overlays/TransformWarningList";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { RESAMPLE_METHODS, resampleSource, type OutOfRange, type ResampleMethod, type ResampleMode } from "../../../lib/transformResample";
import { useResampleDialog } from "../../../store/resampleDialog";
import ResamplePreviewPlot from "./ResamplePreviewPlot";
import { MODE_OPTIONS, OUT_OF_RANGE_OPTIONS } from "./resampleForm";
import { useResample, type ResampleState } from "./useResample";

const fmt = (v: number): string => String(Number(v.toPrecision(5)));
const gap = { marginTop: 8 };

function GridFields({ r }: { r: ResampleState }) {
  const f = r.form;
  switch (f.mode) {
    case "n_points":
      return <NumberField aria-label="Number of points" value={f.nPoints} onChange={(v) => r.setForm({ nPoints: v })} width={90} />;
    case "step":
      return <NumberField aria-label="Step" value={f.step} onChange={(v) => r.setForm({ step: v })} width={90} />;
    case "range":
      return (
        <div style={{ display: "flex", gap: 6 }}>
          <NumberField aria-label="Start" value={f.start} onChange={(v) => r.setForm({ start: v })} width={80} />
          <NumberField aria-label="Step" value={f.rangeStep} onChange={(v) => r.setForm({ rangeStep: v })} width={70} />
          <NumberField aria-label="Stop" value={f.stop} onChange={(v) => r.setForm({ stop: v })} width={80} />
        </div>
      );
    default:
      return (
        <Select
          aria-label="Dataset to match"
          options={r.datasets.map((d) => ({ value: d.id, label: d.name }))}
          value={f.matchId}
          onChange={(e) => r.setForm({ matchId: e.target.value })}
        />
      );
  }
}

function Preview({ r }: { r: ResampleState }) {
  if (r.formError) return <div className="qzk-ds-meta" style={{ ...gap, color: "var(--text-faint)" }}>{r.formError}</div>;
  if (r.loading) return <div className="qzk-ds-meta" style={gap} aria-live="polite">Previewing…</div>;
  const focus = r.targets.find((d) => d.id === r.focusId);
  const entry = r.entries.find((e) => e.id === r.focusId);
  const labels = focus?.data.labels ?? [];
  return (
    <div style={gap} aria-label="Resample preview" role="group">
      {r.targets.length > 1 && (
        <Select
          aria-label="Preview dataset"
          options={r.targets.map((d) => ({ value: d.id, label: d.name }))}
          value={r.focusId}
          onChange={(e) => r.setFocusId(e.target.value)}
        />
      )}
      {labels.length > 1 && (
        <Select
          aria-label="Preview column"
          options={labels.map((l, i) => ({ value: String(i), label: l || `column ${i + 1}` }))}
          value={String(Math.min(r.channel, labels.length - 1))}
          onChange={(e) => r.setChannel(Number(e.target.value))}
          style={{ marginTop: 4 }}
        />
      )}
      {focus && entry?.result && (
        <ResamplePreviewPlot
          source={resampleSource(focus)}
          result={entry.result.data}
          channel={Math.min(r.channel, labels.length - 1)}
        />
      )}
      <ul className="qzk-ds-meta" aria-label="Resample results" style={{ margin: "6px 0 0", paddingLeft: 16 }}>
        {r.entries.map((e) => (
          <li key={e.id} style={e.error ? { color: "var(--danger)" } : undefined}>
            {e.result
              ? `${e.name}: ${e.result.rowsIn} rows → ${e.result.rowsOut} rows (source x ${fmt(e.result.sourceRange[0])} … ${fmt(e.result.sourceRange[1])})`
              : `${e.name}: ${e.error}`}
          </li>
        ))}
      </ul>
      <TransformWarningList warnings={r.warnings} />
    </div>
  );
}

/** Remounted on every opening, so running the command again while the
 *  workshop is open re-seeds the pick from the new selection. */
export default function ResamplePanel() {
  const opened = useResampleDialog((s) => s.opened);
  return <ResampleWorkshop key={opened} />;
}

function ResampleWorkshop() {
  const r = useResample();
  const matchName = r.form.mode === "match" ? r.datasets.find((d) => d.id === r.form.matchId)?.name : undefined;
  const n = r.targets.length;
  return (
    <ToolWindow id="resample" title="Resample / align" width={340} onClose={r.close}>
      {!r.datasets.length ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>Load a dataset to resample.</div>
      ) : (
        <>
          <label className="qzk-field-lbl">Datasets to resample</label>
          <div role="group" aria-label="Datasets to resample" style={{ maxHeight: 110, overflowY: "auto", display: "grid", gap: 2 }}>
            {r.datasets.map((d) => (
              <Checkbox key={d.id} checked={r.picks.includes(d.id)} onChange={(on) => r.togglePick(d.id, on)}>
                {d.name}
              </Checkbox>
            ))}
          </div>

          <label className="qzk-field-lbl" style={gap}>Target grid</label>
          <Select
            aria-label="Target grid"
            options={MODE_OPTIONS}
            value={r.form.mode}
            onChange={(e) => r.setForm({ mode: e.target.value as ResampleMode })}
          />
          <div style={{ marginTop: 4 }}>
            <GridFields r={r} />
          </div>
          {matchName && r.picks.includes(r.form.matchId) && (
            <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
              {matchName} is the grid, so it is not resampled itself.
            </div>
          )}

          <label className="qzk-field-lbl" style={gap}>Interpolation</label>
          <Select
            aria-label="Interpolation"
            options={RESAMPLE_METHODS.map((m) => ({ value: m, label: m }))}
            value={r.form.method}
            onChange={(e) => r.setForm({ method: e.target.value as ResampleMethod })}
          />
          <label className="qzk-field-lbl" style={gap}>Target points outside the data</label>
          <Select
            aria-label="Target points outside the data"
            options={OUT_OF_RANGE_OPTIONS}
            value={r.form.outOfRange}
            onChange={(e) => r.setForm({ outOfRange: e.target.value as OutOfRange })}
          />
          <div style={{ marginTop: 6 }}>
            <Checkbox
              checked={r.form.sortUnsorted}
              onChange={(on) => r.setForm({ sortUnsorted: on })}
              title="A hysteresis loop or repeated sweep is refused unless this is ticked: sorting by x merges its branches."
            >
              Sort x that reverses direction (merges branches)
            </Checkbox>
          </div>

          {n > 0 ? <Preview r={r} /> : (
            <div className="qzk-ds-meta" style={{ ...gap, color: "var(--text-faint)" }}>Tick at least one dataset.</div>
          )}

          {(r.blockedByUnits || r.unitsAcknowledged) && (
            <div style={{ marginTop: 6 }}>
              <Checkbox checked={r.unitsAcknowledged} onChange={r.setUnitsAcknowledged}>
                Resample despite the x unit mismatch
              </Checkbox>
            </div>
          )}

          <Button
            variant="primary"
            size="sm"
            disabled={!r.canCreate}
            onClick={() => void r.create()}
            style={{ marginTop: 12, width: "100%" }}
          >
            {r.busy ? "Creating…" : `Create ${n > 1 ? `${n} resampled datasets` : "resampled dataset"}`}
          </Button>
          {r.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
              {r.error}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
