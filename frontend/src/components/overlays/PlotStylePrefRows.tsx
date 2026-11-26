// Preferences ▸ Plot: the plot-style defaults (PREFS_AUDIT lane 2) and the
// series palette / "Vary dash & marker" mirrors. Palette and Vary dash share
// state with the title-bar Appearance gear (the same `qz.prefs` fields, so a
// change in either shows in both). Every default is today's behaviour
// (provisional, owner to confirm); see lib/plotStylePrefs.ts.

import type { TickDirection } from "../../lib/plotStylePrefs";
import { FONT_SIZE_RANGE, MARKER_SIZE_RANGE, PLOT_STYLE_DEFAULTS, plotStylePrefsSlot } from "../../lib/plotStylePrefsSlot";
import type { LegendPos } from "../../lib/plotview";
import { PALETTES } from "../../lib/palettes";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { SliderRow } from "../primitives/SliderRow";
import { Switch } from "../primitives/Switch";
import PrefRow from "./PrefRow";

const PALETTE_OPTS = PALETTES.map((p) => ({ value: p.value, label: p.label }));
const TICK_OPTS: { value: TickDirection; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "out", label: "Out" },
  { value: "in", label: "In" },
  { value: "both", label: "Both" },
];
const LEGEND_OPTS: { value: LegendPos; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "ne", label: "Top right" },
  { value: "nw", label: "Top left" },
  { value: "se", label: "Bottom right" },
  { value: "sw", label: "Bottom left" },
];

export default function PlotStylePrefRows() {
  const style = plotStylePrefsSlot.use();
  const palette = useApp((s) => s.palette);
  const setPalette = useApp((s) => s.setPalette);
  const autoSeriesStyles = useApp((s) => s.autoSeriesStyles);
  const setPref = useApp((s) => s.setPref);
  const save = (patch: Partial<typeof style>) => plotStylePrefsSlot.save({ ...style, ...patch });
  return (
    <>
      <PrefRow label="Series palette" hint="the colour cycle for series (also in the title-bar Appearance menu)">
        <Select aria-label="Series palette" options={PALETTE_OPTS} value={palette} onChange={(e) => setPalette(e.target.value)} />
      </PrefRow>
      <PrefRow label="Vary dash & marker" hint="cycle dash and marker glyph as well as colour, so series read in grayscale (also in the Appearance menu)">
        <Switch aria-label="Vary dash and marker" checked={autoSeriesStyles} onChange={(v) => setPref("autoSeriesStyles", v)} />
      </PrefRow>
      <PrefRow label="Marker size" hint={`pt; the canvas draws it as screen pixels, the export in points (default ${PLOT_STYLE_DEFAULTS.markerSize})`}>
        <div style={{ width: 160 }}>
          <SliderRow
            aria-label="Marker size"
            label="pt"
            value={style.markerSize}
            min={MARKER_SIZE_RANGE[0]}
            max={MARKER_SIZE_RANGE[1]}
            step={1}
            onChange={(v) => save({ markerSize: v })}
            format={(v) => String(v)}
          />
        </div>
      </PrefRow>
      <PrefRow label="Font size" hint={`px; the Screen template's axis text only, other templates keep their own (default ${PLOT_STYLE_DEFAULTS.fontSize})`}>
        <div style={{ width: 160 }}>
          <SliderRow
            aria-label="Font size"
            label="px"
            value={style.fontSize}
            min={FONT_SIZE_RANGE[0]}
            max={FONT_SIZE_RANGE[1]}
            step={1}
            onChange={(v) => save({ fontSize: v })}
            format={(v) => String(v)}
          />
        </div>
      </PrefRow>
      <PrefRow label="Tick direction" hint="new plots; Auto = outward on screen, the style preset's direction in exports">
        <Select aria-label="Tick direction" options={TICK_OPTS} value={style.tickDirection} onChange={(e) => save({ tickDirection: e.target.value as TickDirection })} />
      </PrefRow>
      <PrefRow label="Legend position" hint="new plots; Auto places the legend where it covers the least data">
        <Select aria-label="Legend position" options={LEGEND_OPTS} value={style.legendPos} onChange={(e) => save({ legendPos: e.target.value as LegendPos })} />
      </PrefRow>
    </>
  );
}
