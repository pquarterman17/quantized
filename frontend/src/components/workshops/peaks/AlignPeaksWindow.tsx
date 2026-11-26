// Align to peak: a ToolWindow opened from the Peaks panel. Pick datasets, a
// window around the reference peak and a target (the first dataset's peak, or
// a typed position), measure, read the position / shift table, then add the
// shifted copies to the library as derived datasets (X moved, Y untouched).
// Loaded lazily from PeaksPanel; state is ./useAlignPeaks, rules ./alignPeaks.

import { Checkbox } from "../../primitives/Checkbox";
import { Button, Select, StatusDot } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import ToolWindow from "../../overlays/ToolWindow";
import ReopenBanner from "../resultcommit/ReopenBanner";
import { useReopenScope } from "../resultcommit/useReopenSession";
import { WorkbenchMessage, OutOfDateNote } from "../workbench/WorkbenchParts";
import { useAlignPeaks } from "./useAlignPeaks";

const faint = { color: "var(--text-faint)" } as const;
const num = (v: number): string => (Number.isFinite(v) ? String(Number(v.toPrecision(8))) : "");

/** Remounts the body for each "Open in Align to peak" session (it seeds once, at mount). */
export default function AlignPeaksWindow(props: { seedPeaks: readonly { center: number; fwhm: number }[]; onClose: () => void }) {
  return <AlignPeaksBody key={useReopenScope("peak-align")} {...props} />;
}

function AlignPeaksBody({ seedPeaks, onClose }: {
  /** The Peaks panel's peaks: the first one seeds the window. */
  seedPeaks: readonly { center: number; fwhm: number }[];
  onClose: () => void;
}) {
  const a = useAlignPeaks(seedPeaks);
  const ch = a.channels;
  const val = (v: number) => (Number.isFinite(v) ? v : undefined);

  return (
    <ToolWindow id="peaks-align" title="Align to peak" width={460} onClose={onClose}>
      <ReopenBanner tool="peak-align" />
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 0 }}>
        {ch
          ? <>Moves the X of each dataset so its peak in <b>{ch.yLabel}</b> sits on one position. Y is untouched; the
            originals are kept and aligned copies are added.</>
          : "Select a dataset whose Y is plotted: the peak is measured on that column."}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <span className="qzk-field-lbl" style={{ margin: 0, flex: 1 }}>Datasets ({a.picked.length} picked)</span>
        <Button size="sm" disabled={a.busy || a.selectedIds.length === 0} onClick={() => a.setPicked([...a.selectedIds])}>
          Library selection ({a.selectedIds.length})
        </Button>
        <Button size="sm" disabled={a.busy} onClick={() => a.setPicked(a.datasets.map((d) => d.id))}>All</Button>
        <Button size="sm" disabled={a.busy} onClick={() => a.setPicked([])}>None</Button>
      </div>
      <div role="group" aria-label="align datasets" style={{ maxHeight: 120, overflow: "auto", marginTop: 4 }}>
        {a.datasets.map((d) => (
          <Checkbox key={d.id} checked={a.picked.includes(d.id)} disabled={a.busy} onChange={() => a.togglePicked(d.id)}>
            {d.name}
          </Checkbox>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }} title="The peak is the highest point in this X window; its position is a parabola through the top three points.">Peak window</span>
        <BufferedNumberField aria-label="peak window low" value={val(a.lo)} width={80} disabled={a.busy}
          onValue={(v) => a.setLo(v ?? Number.NaN)} />
        <span style={faint}>–</span>
        <BufferedNumberField aria-label="peak window high" value={val(a.hi)} width={80} disabled={a.busy}
          onValue={(v) => a.setHi(v ?? Number.NaN)} />
        <Button size="sm" disabled={a.busy || !a.roi} title="The plot's ROI band." onClick={() => a.roi && (a.setLo(a.roi[0]), a.setHi(a.roi[1]))}>
          From ROI
        </Button>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}
          title="The highest point must stand this many noise levels above the window baseline or the spectrum is refused; 0 turns the check off.">Min. peak height (noise levels)</span>
        <BufferedNumberField aria-label="minimum peak height" value={val(a.minSnr)} width={60} disabled={a.busy}
          onValue={(v) => a.setMinSnr(v ?? Number.NaN)} />
      </div>
      <Checkbox checked={a.follow} disabled={a.busy} onChange={() => a.setFollow(!a.follow)}>
        Window follows each spectrum's peak (searches one window width either side of the window)
      </Checkbox>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>Align to</span>
        <Select
          aria-label="align target"
          options={[{ value: "first", label: "First dataset's peak" }, { value: "typed", label: "Typed position" }]}
          value={a.targetMode}
          disabled={a.busy}
          onChange={(e) => a.setTargetMode(e.target.value === "typed" ? "typed" : "first")}
        />
        {a.targetMode === "typed" && (
          <BufferedNumberField aria-label="target position" value={val(a.typed)} width={90} disabled={a.busy}
            onValue={(v) => a.setTyped(v ?? Number.NaN)} />
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <Button size="sm" variant="primary" disabled={a.busy || a.block !== null} title={a.block ?? undefined}
          onClick={() => void a.start()}>
          {a.busy ? "Measuring…" : "Measure"}
        </Button>
        {a.phase !== "idle" && (
          <div role="status" aria-label="align status">
            <StatusDot
              tone={a.phase === "done" ? "ok" : a.phase === "failed" ? "danger" : "accent"}
              label={a.phase === "done" ? `${a.rows?.filter((r) => r.ok).length ?? 0}/${a.rows?.length ?? 0} ok` : a.phase}
            />
          </div>
        )}
      </div>
      {a.block && !a.busy && <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>{a.block}</div>}
      <WorkbenchMessage refusal={a.refusal ? a.error : null} error={a.refusal ? null : a.error} />

      {a.rows && (
        <div role="region" aria-label="alignment results" style={{ marginTop: 8 }}>
          {a.stale && <OutOfDateNote block>the inputs changed after this measurement. Measure again before adding the aligned datasets.</OutOfDateNote>}
          <table className="qzk-table" style={{ width: "100%" }}>
            <thead><tr><th>Dataset</th><th>Peak</th><th>Shift</th><th>Status</th></tr></thead>
            <tbody>
              {a.rows.map((r) => (
                <tr key={r.datasetId}>
                  <td>{r.name}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{r.position === null ? "" : num(r.position)}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{r.shift === null ? "" : num(r.shift)}</td>
                  <td>{r.ok ? "ok" : r.error ?? "failed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <Button size="sm" variant="primary" disabled={!a.canAdd} onClick={() => a.addAligned()}>
              Add aligned datasets
            </Button>
            {a.target !== null && <span className="qzk-ds-meta" style={{ ...faint, margin: 0 }}>target {num(a.target)}</span>}
          </div>
          {a.added && <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>{a.added}</div>}
        </div>
      )}
    </ToolWindow>
  );
}
