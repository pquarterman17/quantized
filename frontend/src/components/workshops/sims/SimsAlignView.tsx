// SIMS workshop, Align tab — view (roadmap row 23). Shifts each picked
// profile's depth so a reference species' peak (or junction) depth coincides
// with the first profile's, then lays the species side by side in one
// worksheet. Thin — the logic lives in useSimsAlign. The aligned preview is
// provisional (owner to confirm the single combined worksheet).

import TransformWarningList from "../../overlays/TransformWarningList";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { WorkbenchPreviewFrame } from "../workbench/WorkbenchParts";
import SimsPreviewPlot from "./SimsPreviewPlot";
import { useSimsAlign, type SimsAlignState } from "./useSimsAlign";

const gap = { marginTop: 8 };
const faint = { color: "var(--text-faint)" } as const;
const list = { display: "grid", gap: 2, maxHeight: 110, overflowY: "auto" } as const;
const g = (v: number): string => String(Number(v.toPrecision(5)));

function Preview({ r }: { r: SimsAlignState }) {
  if (r.formError) return <div className="qzk-ds-meta" style={{ ...gap, ...faint }}>{r.formError}</div>;
  if (r.loading) return <WorkbenchPreviewFrame loading />;
  if (r.previewError) {
    return <div className="qzk-ds-meta" role="alert" style={{ ...gap, color: "var(--danger)" }}>{r.previewError}</div>;
  }
  const res = r.result;
  if (!res) return null;
  return (
    <WorkbenchPreviewFrame>
      <div style={gap} aria-label="Alignment preview" role="group">
        <SimsPreviewPlot data={res.data} />
        <div className="qzk-ds-meta" style={{ marginTop: 4 }}>
          Provisional: one combined worksheet (owner to confirm). Depth in {res.depthUnit || "unrecorded unit"}.
        </div>
        <ul className="qzk-ds-meta" aria-label="Depth shifts" style={{ margin: "4px 0 0", paddingLeft: 16 }}>
          {res.shifts.map((s) => (
            <li key={s.id}>{s.name}: {r.by} at {g(s.referenceDepth)}, shifted by {g(-s.shift)}</li>
          ))}
        </ul>
        {r.previewOnly && (
          <div className="qzk-helptext" style={{ marginTop: 4, ...faint }}>
            Previewed on the loaded rows; the full data are aligned when you create.
          </div>
        )}
        <TransformWarningList warnings={r.warnings} />
      </div>
    </WorkbenchPreviewFrame>
  );
}

export default function SimsAlignView({ active }: { active: boolean }) {
  const r = useSimsAlign(active);
  return (
    <div>
      <label className="qzk-field-lbl">Profiles (the first is the depth reference)</label>
      <div role="group" aria-label="Profiles to align" style={list}>
        {r.datasets.map((d) => (
          <Checkbox key={d.id} checked={r.picked.includes(d.id)} onChange={(on) => r.togglePicked(d.id, on)}>
            {d.name}
          </Checkbox>
        ))}
      </div>
      <div style={{ ...gap, display: "flex", gap: 6, alignItems: "center" }}>
        <span className="qzk-ds-meta">Align on the</span>
        <Select
          aria-label="Align on"
          options={[{ value: "peak", label: "peak depth" }, { value: "junction", label: "junction depth" }]}
          value={r.by}
          onChange={(e) => r.setBy(e.target.value as "peak" | "junction")}
        />
        <span className="qzk-ds-meta">of</span>
        <Select
          aria-label="Reference species"
          options={r.commonSpecies.map((s) => ({ value: s, label: s }))}
          value={r.reference}
          onChange={(e) => r.setReference(e.target.value)}
        />
      </div>
      {r.by === "junction" && (
        <div style={{ ...gap, display: "flex", gap: 6, alignItems: "center" }}>
          <span className="qzk-ds-meta">Junction at</span>
          <NumberField aria-label="Junction threshold (percent of peak)" value={r.thresholdPct} onChange={r.setThresholdPct} width={50} unit="% of peak" />
        </div>
      )}
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 2 }}>
        Depths come from the Region tab's measures over each profile's whole depth range; a profile with no
        peak or junction, a missing species or a different depth unit refuses.
      </div>
      <label className="qzk-field-lbl" style={gap}>Also include</label>
      <div role="group" aria-label="Also include" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.commonSpecies.filter((s) => s !== r.reference).map((s) => (
          <Checkbox key={s} checked={r.extra.includes(s)} onChange={(on) => r.toggleExtra(s, on)}>{s}</Checkbox>
        ))}
      </div>
      <Preview r={r} />
      <Button variant="primary" size="sm" disabled={!r.canCreate} onClick={() => void r.create()} style={{ marginTop: 12, width: "100%" }}>
        {r.busy ? "Creating…" : "Create aligned worksheet"}
      </Button>
      {r.error && (
        <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>{r.error}</div>
      )}
    </div>
  );
}
