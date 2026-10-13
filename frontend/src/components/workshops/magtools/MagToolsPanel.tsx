// Magnetometry tools workshop — view. A draggable ToolWindow with two transforms:
// "Background" removes a linear background — the one-sided high-T fit for M(T),
// the two-tail susceptibility removal + re-centring for an M(H) loop, chosen by
// what the x axis declares itself to be (BUG-021); "Units" converts field/moment
// units (sample-aware). Each writes a new dataset to the library.
// Thin — all state/logic lives in the hook; the math is golden in calc.magnetometry.

import ToolWindow from "../../overlays/ToolWindow";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { AREA_UNITS, LENGTH_UNITS, MASS_UNITS, VOLUME_UNITS, normalizationProblem, resolvedSampleVolume, type AreaUnit, type LengthUnit, type MassUnit, type VolumeUnit } from "../../../lib/sampleGeometry";
import { useApp } from "../../../store/useApp";
import {
  DEFAULT_AUTO_FRACTION,
  DEFAULT_HI_FRACTION,
  FIELD_UNITS,
  MOMENT_UNITS,
  useMagTools,
  type MagBgMode,
  type MagTab,
} from "./useMagTools";

const unitOpts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));

const BG_MODE_OPTS: { value: MagBgMode; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "mt", label: "M(T) — high-T tail" },
  { value: "mh", label: "M(H) — hysteresis loop" },
];

/** What the selected path actually does, in one sentence. The M(T) wording is
 *  only true of the M(T) path — saying it over a loop is how the wrong
 *  analysis went unnoticed. */
function bgDescription(path: "mt" | "mh" | null, reason: string): string {
  if (path === "mt") return "Fits a line to the high-T tail of M(T) and subtracts it.";
  if (path === "mh")
    return "Fits both saturated tails of the M(H) loop, removes the average susceptibility χ·H, and re-centres the loop on its saturation midpoint.";
  return `Cannot tell M(T) from M(H) — ${reason}. Pick the data type to continue.`;
}

export default function MagToolsPanel() {
  const setOpen = useApp((s) => s.setMagToolsOpen);
  const m = useMagTools();
  // The readout's units: a slope/χ is moment per x, an intercept/offset is moment.
  const { fromField: xU, fromMoment: mU } = m.units;
  const perX = mU && xU ? ` ${mU}/${xU}` : "";
  const inM = mU ? ` ${mU}` : "";

  return (
    <ToolWindow id="magtools" title="Magnetometry" width={330} onClose={() => setOpen(false)}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <label className="qzk-field-lbl" style={{ margin: 0 }} htmlFor="magbg-mode">
              Data type
            </label>
            <Select
              aria-label="Target field unit"
              id="magbg-mode"
              options={BG_MODE_OPTS}
              value={m.bgMode}
              onChange={(e) => m.setBgMode(e.target.value as MagBgMode)}
            />
          </div>
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginBottom: 10 }}>
            {bgDescription(m.bgPath, m.detection.reason)}
            {m.bgMode === "auto" && m.bgPath && ` (${m.detection.reason})`}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {m.bgPath === "mh" ? (
              <>
                <label className="qzk-field-lbl" style={{ margin: 0 }} htmlFor="magbg-frac">
                  High-field fraction
                </label>
                <NumberField
                  id="magbg-frac"
                  value={m.hiFraction}
                  width={64}
                  step={0.05}
                  onChange={(v) =>
                    m.setHiFraction(Math.min(1, Math.max(0.01, Number(v) || DEFAULT_HI_FRACTION)))
                  }
                />
              </>
            ) : (
              <>
                <label className="qzk-field-lbl" style={{ margin: 0 }} htmlFor="magbg-frac">
                  High-T fraction
                </label>
                <NumberField
                  id="magbg-frac"
                  value={m.autoFraction}
                  width={64}
                  step={0.05}
                  onChange={(v) =>
                    m.setAutoFraction(
                      Math.min(1, Math.max(0.01, Number(v) || DEFAULT_AUTO_FRACTION)),
                    )
                  }
                />
              </>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!m.active || m.busy || !m.bgPath}
              onClick={() => void m.subtractBackground()}
            >
              {m.busy ? "Working…" : "Subtract background →"}
            </Button>
          </div>
          {m.fit && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              {m.fit.kind === "mh"
                ? `removed: χ ${fmtNum(m.fit.slope)}${perX}, offset ${fmtNum(m.fit.offset)}${inM}`
                : `fit: slope ${fmtNum(m.fit.slope)}${perX}, intercept ${fmtNum(m.fit.intercept)}${inM}`}
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
              aria-label="Target field unit"
              options={unitOpts(FIELD_UNITS)}
              value={m.units.toField}
              disabled={m.detection.kind !== "field"}
              title={m.detection.kind !== "field" ? "The x axis is not a field, so it is not converted." : undefined}
              onChange={(e) => m.setUnits({ toField: e.target.value })}
            />
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Moment {m.units.fromMoment} →
            </label>
            <Select
              aria-label="Target moment unit"
              options={unitOpts(MOMENT_UNITS)}
              value={m.units.toMoment}
              onChange={(e) => m.setUnits({ toMoment: e.target.value })}
            />
            <label className="qzk-field-lbl" style={{ margin: 0 }}>Sample mass</label>
            <span className="qz-mag-quantity"><NumberField aria-label="Sample mass" value={m.units.sampleMass} width={80}
              onChange={(v) => m.setUnits({ sampleMass: Number(v) || 0 })} />
              <Select aria-label="Sample mass unit" options={unitOpts([...MASS_UNITS])} value={m.units.massUnit}
                onChange={(e) => m.setUnits({ massUnit: e.target.value as MassUnit })} /></span>
            <label className="qzk-field-lbl" style={{ margin: 0 }}>Volume from</label>
            <Select options={[{ value: "direct", label: "Direct volume" }, { value: "film", label: "Width × height × thickness" },
              { value: "area", label: "Area × thickness" }, { value: "circle", label: "Diameter × thickness" }]}
              aria-label="Volume geometry"
              value={m.units.volumeMode} onChange={(e) => m.setUnits({ volumeMode: e.target.value as typeof m.units.volumeMode })} />
          </div>
          {m.units.volumeMode === "direct" ? <div className="qz-mag-geometry-row">
            <label className="qzk-field-lbl">Volume</label>
            <NumberField aria-label="Sample volume" value={m.units.sampleVolume} width={80} onChange={(v) => m.setUnits({ sampleVolume: Number(v) || 0 })} />
            <Select aria-label="Sample volume unit" options={unitOpts([...VOLUME_UNITS])} value={m.units.volumeUnit}
              onChange={(e) => m.setUnits({ volumeUnit: e.target.value as VolumeUnit })} />
          </div> : m.units.volumeMode === "film" ? <div className="qz-mag-geometry">
            {(["Width", "Height", "Thickness"] as const).map((label) => {
              const prefix = label === "Width" ? "width" : label === "Height" ? "height" : "thickness";
              const valueKey = label === "Width" ? "sampleWidth" : label === "Height" ? "sampleHeight" : "sampleThickness";
              const unitKey = `${prefix}Unit` as "widthUnit" | "heightUnit" | "thicknessUnit";
              return <div className="qz-mag-geometry-row" key={label}><label className="qzk-field-lbl">{label}</label>
                <NumberField aria-label={label} value={m.units[valueKey]} width={80} onChange={(v) => m.setUnits({ [valueKey]: Number(v) || 0 })} />
                <Select aria-label={`${label} unit`} options={unitOpts([...LENGTH_UNITS])} value={m.units[unitKey]}
                  onChange={(e) => m.setUnits({ [unitKey]: e.target.value as LengthUnit })} /></div>;
            })}
          </div> : <div className="qz-mag-geometry">
            <div className="qz-mag-geometry-row"><label className="qzk-field-lbl">{m.units.volumeMode === "area" ? "Area" : "Diameter"}</label>
              <NumberField aria-label={m.units.volumeMode === "area" ? "Area" : "Diameter"} value={m.units.volumeMode === "area" ? m.units.sampleArea : m.units.sampleDiameter} width={80}
                onChange={(v) => m.setUnits(m.units.volumeMode === "area" ? { sampleArea: Number(v) || 0 } : { sampleDiameter: Number(v) || 0 })} />
              {m.units.volumeMode === "area" ? <Select aria-label="Area unit" options={unitOpts([...AREA_UNITS])} value={m.units.areaUnit}
                onChange={(e) => m.setUnits({ areaUnit: e.target.value as AreaUnit })} />
                : <Select aria-label="Diameter unit" options={unitOpts([...LENGTH_UNITS])} value={m.units.diameterUnit}
                  onChange={(e) => m.setUnits({ diameterUnit: e.target.value as LengthUnit })} />}
            </div>
            <div className="qz-mag-geometry-row"><label className="qzk-field-lbl">Thickness</label>
              <NumberField aria-label="Thickness" value={m.units.sampleThickness} width={80} onChange={(v) => m.setUnits({ sampleThickness: Number(v) || 0 })} />
              <Select aria-label="Thickness unit" options={unitOpts([...LENGTH_UNITS])} value={m.units.thicknessUnit}
                onChange={(e) => m.setUnits({ thicknessUnit: e.target.value as LengthUnit })} /></div>
          </div>}
          {resolvedSampleVolume(m.units) > 0 && <div className="qzk-ds-meta qz-mag-volume-readout">
            Calculated volume: {fmtNum(resolvedSampleVolume(m.units))} cm³
          </div>}
          <div style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!m.active || m.busy || normalizationProblem(m.units) !== null}
              onClick={() => void m.convert()}
            >
              {m.busy ? "Converting…" : "Convert →"}
            </Button>
          </div>
          {normalizationProblem(m.units) && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>
            {normalizationProblem(m.units)}
          </div>}
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
