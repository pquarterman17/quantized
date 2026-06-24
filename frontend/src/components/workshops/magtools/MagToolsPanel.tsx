// Magnetometry tools workshop — view. A draggable ToolWindow with two transforms:
// "Background" subtracts a linear high-T background from M(T); "Units" converts
// field/moment units (sample-aware). Each writes a new dataset to the library.
// Thin — all state/logic lives in the hook; the math is golden in calc.magnetometry.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField, SegmentedControl, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import {
  FIELD_UNITS,
  MOMENT_UNITS,
  useMagTools,
  type MagTab,
} from "./useMagTools";

const unitOpts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));

export default function MagToolsPanel() {
  const setOpen = useApp((s) => s.setMagToolsOpen);
  const m = useMagTools();

  return (
    <ToolWindow title="Magnetometry" width={330} onClose={() => setOpen(false)}>
      <SegmentedControl<MagTab>
        options={[
          { value: "background", label: "Background" },
          { value: "units", label: "Units" },
        ]}
        value={m.tab}
        onChange={m.setTab}
      />

      {!m.active && (
        <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
          Select a dataset first.
        </div>
      )}

      {m.tab === "background" ? (
        <div style={{ marginTop: 12 }}>
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginBottom: 10 }}>
            Fits a line to the high-T tail of M(T) and subtracts it.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              High-T fraction
            </label>
            <NumberField
              value={m.autoFraction}
              width={64}
              step={0.05}
              onChange={(v) => m.setAutoFraction(Math.min(1, Math.max(0.01, Number(v) || 0.1)))}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!m.active || m.busy}
              onClick={() => void m.subtractBackground()}
            >
              {m.busy ? "Working…" : "Subtract background →"}
            </Button>
          </div>
          {m.fit && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              fit: slope {fmtNum(m.fit.slope)}, intercept {fmtNum(m.fit.intercept)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto",
              gap: "6px 12px",
              alignItems: "center",
            }}
          >
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Field {m.units.fromField} →
            </label>
            <Select
              options={unitOpts(FIELD_UNITS)}
              value={m.units.toField}
              onChange={(e) => m.setUnits({ toField: e.target.value })}
            />
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Moment emu →
            </label>
            <Select
              options={unitOpts(MOMENT_UNITS)}
              value={m.units.toMoment}
              onChange={(e) => m.setUnits({ toMoment: e.target.value })}
            />
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Sample mass (g)
            </label>
            <NumberField
              value={m.units.sampleMass}
              width={80}
              onChange={(v) => m.setUnits({ sampleMass: Number(v) || 0 })}
            />
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Volume (cm³)
            </label>
            <NumberField
              value={m.units.sampleVolume}
              width={80}
              onChange={(v) => m.setUnits({ sampleVolume: Number(v) || 0 })}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!m.active || m.busy}
              onClick={() => void m.convert()}
            >
              {m.busy ? "Converting…" : "Convert →"}
            </Button>
          </div>
        </div>
      )}

      {m.warning && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--warn, #c90)" }}>
          {m.warning}
        </div>
      )}
      {m.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {m.error}
        </div>
      )}
    </ToolWindow>
  );
}
