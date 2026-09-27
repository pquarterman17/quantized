// SIMS workshop, Compare tab — view (audit P2.3, box 3). Several profiles'
// species side by side in one comparison table for a log-y overlay, with an
// optional decade stagger; below it, the decade offsets of the current plot.
// Thin — the logic lives in useSimsCompare and SimsOffsets.

import TransformWarningList from "../../overlays/TransformWarningList";
import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import SimsOffsets from "./SimsOffsets";
import SimsPreviewPlot from "./SimsPreviewPlot";
import { useSimsCompare, MAX_STAGGER, type SimsCompareState } from "./useSimsCompare";

const gap = { marginTop: 8 };
const faint = { color: "var(--text-faint)" } as const;
const list = { display: "grid", gap: 2, maxHeight: 110, overflowY: "auto" } as const;

function Preview({ r }: { r: SimsCompareState }) {
  if (r.formError) return <div className="qzk-ds-meta" style={{ ...gap, ...faint }}>{r.formError}</div>;
  if (r.loading) return <div className="qzk-ds-meta" style={gap} aria-live="polite">Previewing…</div>;
  if (r.previewError) {
    return <div className="qzk-ds-meta" role="alert" style={{ ...gap, color: "var(--danger)" }}>{r.previewError}</div>;
  }
  const res = r.result;
  if (!res) return null;
  const rows = res.data.time.length;
  return (
    <div style={gap} aria-label="Comparison preview" role="group">
      <SimsPreviewPlot data={res.data} offsets={r.offsets} />
      <div className="qzk-ds-meta" style={{ marginTop: 4 }}>
        {res.data.labels.length} trace{res.data.labels.length === 1 ? "" : "s"} · {rows} rows (one block per profile;
        nothing interpolated)
      </div>
      {r.previewOnly && (
        <div className="qzk-ds-meta" style={{ marginTop: 4, ...faint }}>
          Previewed on the loaded rows; the full data are compared when you create.
        </div>
      )}
      <TransformWarningList warnings={r.warnings} />
    </div>
  );
}

export default function SimsCompareView() {
  const r = useSimsCompare();
  return (
    <div>
      <label className="qzk-field-lbl">Profiles</label>
      <div role="group" aria-label="Profiles" style={list}>
        {r.datasets.map((d) => (
          <Checkbox key={d.id} checked={r.picked.includes(d.id)} onChange={(on) => r.togglePicked(d.id, on)}>
            {d.name}
          </Checkbox>
        ))}
      </div>
      <label className="qzk-field-lbl" style={gap}>Species</label>
      <div role="group" aria-label="Species" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.speciesOptions.map((o) => (
          <Checkbox key={o.name} checked={r.species.includes(o.name)} onChange={(on) => r.toggleSpecies(o.name, on)}>
            {o.name}
            {r.picked.length > 1 && o.count < r.picked.length ? ` (${o.count}/${r.picked.length})` : ""}
          </Checkbox>
        ))}
      </div>
      <div style={{ ...gap, display: "flex", gap: 6, alignItems: "center" }}>
        <span className="qzk-ds-meta">Stagger each trace by</span>
        <NumberField aria-label="Stagger (decades per trace)" value={r.stagger} onChange={r.setStagger} width={44} unit="decades" />
      </div>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 2 }}>
        Trace n is drawn at y × 10<sup>n·k</sup> on the plot (whole decades, |k| ≤ {MAX_STAGGER}); the table keeps
        the true values.
      </div>
      <Preview r={r} />
      <Button
        variant="primary"
        size="sm"
        disabled={!r.canCreate}
        onClick={() => void r.create()}
        style={{ marginTop: 12, width: "100%" }}
      >
        {r.busy ? "Creating…" : "Create comparison"}
      </Button>
      {r.error && (
        <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
          {r.error}
        </div>
      )}
      <label className="qzk-field-lbl" style={{ marginTop: 14 }}>Decade offsets on the current plot</label>
      <SimsOffsets />
    </div>
  );
}
