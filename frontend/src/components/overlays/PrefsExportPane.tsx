// Preferences ▸ Export (PREFS_AUDIT lane 2, P1-4): what a new export starts
// from. Vector PDF stays the default; every default equals today's behaviour
// (provisional, owner to confirm). A style preset's calibrated DPI WINS over
// the DPI here (owner decision 2026-11-25); see lib/exportPrefs.ts.

import { EXPORT_FORMATS, exportPrefsSlot, type ExportFormat } from "../../lib/exportPrefs";
import { PRESET_ORDER, presetLabel } from "../../lib/figurePresets";
import { Select } from "../primitives";
import { Switch } from "../primitives/Switch";
import PrefRow from "./PrefRow";

const FORMAT_OPTS = EXPORT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }));
const PRESET_OPTS = PRESET_ORDER.map((id) => ({ value: id, label: presetLabel(id) }));
const DPI_CHOICES = [150, 200, 300, 600, 1200];

export default function PrefsExportPane() {
  const p = exportPrefsSlot.use();
  const save = (patch: Partial<typeof p>) => exportPrefsSlot.save({ ...p, ...patch });
  const dpiOpts = [
    { value: "0", label: "Preset / dialog default" },
    ...[...new Set([...DPI_CHOICES, ...(p.dpi > 0 ? [p.dpi] : [])])].sort((a, b) => a - b).map((d) => ({ value: String(d), label: `${d} dpi` })),
  ];
  return (
    <>
      <PrefRow label="Default format" hint="PDF / SVG / EPS are vector (the default is PDF); PNG / TIFF are raster">
        <Select aria-label="Default export format" options={FORMAT_OPTS} value={p.format} onChange={(e) => save({ format: e.target.value as ExportFormat })} />
      </PrefRow>
      <PrefRow label="Default size" hint="the style preset a new export starts with; each preset sets the figure size, and a window's Page setup still overrides it">
        <Select aria-label="Default export size" options={PRESET_OPTS} value={p.stylePreset} onChange={(e) => save({ stylePreset: e.target.value })} />
      </PrefRow>
      <PrefRow label="Raster DPI" hint="PNG / TIFF resolution. A style preset's own calibrated DPI (APS, Nature, Thesis ...) wins; this applies to the Default preset">
        <Select aria-label="Default export DPI" options={dpiOpts} value={String(p.dpi)} onChange={(e) => save({ dpi: Number(e.target.value) })} />
      </PrefRow>
      <PrefRow label="Transparent background" hint="file exports (PDF / SVG / PNG) draw no background; Copy figure has its own setting under Plot">
        <Switch aria-label="Transparent export background" checked={p.transparent} onChange={(v) => save({ transparent: v })} />
      </PrefRow>
      <PrefRow label="Text as paths" hint="SVG only: write glyphs as outlines so the file needs no installed font (text is no longer editable)">
        <Switch aria-label="Export text as paths" checked={p.textAsPaths} onChange={(v) => save({ textAsPaths: v })} />
      </PrefRow>
    </>
  );
}
