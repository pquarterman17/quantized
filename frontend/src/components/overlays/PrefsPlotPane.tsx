// Preferences ▸ Plot (split out of PreferencesDialog.tsx, PREFS_AUDIT lane 1).
// Lane 2's plot-style rows live in PlotStylePrefRows.tsx. Lazy with the dialog.

import { plotPerfPrefsSlot, toolbarPrefsSlot } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { SliderRow } from "../primitives/SliderRow";
import { Switch } from "../primitives/Switch";
import { DefaultGraphTemplatePref } from "./DefaultGraphTemplatePref";
import PrefRow from "./PrefRow";
import PlotStylePrefRows from "./PlotStylePrefRows";

const TRACE_OPTS = ["Line", "Line + markers", "Scatter", "Step"].map((v) => ({ value: v, label: v }));

export default function PrefsPlotPane() {
  const p = useApp((s) => s);
  const setPref = useApp((s) => s.setPref);
  // Store-independent slots read through their hook, so a change made
  // elsewhere (the toolbar flyout, a reset) shows here at once (P2-14).
  const { decimateDensePlots } = plotPerfPrefsSlot.use();
  const toolbarPrefs = toolbarPrefsSlot.use();
  const { showGroupLabels } = toolbarPrefs;
  return (
    <>
      <PrefRow label="Default trace">
        <Select
          aria-label="Default trace"
          options={TRACE_OPTS}
          value={p.defaultTrace}
          onChange={(e) => setPref("defaultTrace", e.target.value)}
        />
      </PrefRow>
      <PrefRow label="Default line width" hint="pt; the canvas draws it as screen pixels, the export in points">
        <div style={{ width: 160 }}>
          <SliderRow
            aria-label="Line width"
            label="pt"
            value={p.defaultLineWidth}
            min={0.5}
            max={4}
            step={0.5}
            onChange={(v) => setPref("defaultLineWidth", v)}
            format={(v) => v.toFixed(1)}
          />
        </div>
      </PrefRow>
      <PrefRow label="Grid lines" hint="the grid every new plot starts with; open plots keep their own">
        <Switch aria-label="Grid lines" checked={p.defaultGrid} onChange={(v) => setPref("defaultGrid", v)} />
      </PrefRow>
      <PlotStylePrefRows />
      <DefaultGraphTemplatePref />
      <PrefRow label="Multi-panel fit" hint="fresh Origin multi-panel figures">
        <SegmentedControl
          options={["Aspect", "Fill"]}
          value={p.defaultPanelFit === "window" ? "Fill" : "Aspect"}
          onChange={(v) => setPref("defaultPanelFit", v === "Fill" ? "window" : "frames")}
        />
      </PrefRow>
      <PrefRow
        label="Excluded rows"
        hint="how excluded rows draw on XY plot windows: hidden, or grayed out in place. Display only: it does not change which rows are excluded"
      >
        <SegmentedControl
          options={["Hide", "Gray"]}
          value={p.excludedDisplay === "grey" ? "Gray" : "Hide"}
          onChange={(v) => setPref("excludedDisplay", v === "Gray" ? "grey" : "hide")}
        />
      </PrefRow>
      <PrefRow label="Copy figure background" hint="transparent pastes onto colored slides; opaque is safer for Word/print">
        <SegmentedControl
          options={["Opaque", "Transparent"]}
          value={p.copyFigureTransparent ? "Transparent" : "Opaque"}
          onChange={(v) => setPref("copyFigureTransparent", v === "Transparent")}
        />
      </PrefRow>
      <PrefRow label="Antialias 2-D map" hint="smooth vs crisp heatmap cells">
        <Switch aria-label="Antialias map" checked={p.antialias} onChange={(v) => setPref("antialias", v)} />
      </PrefRow>
      <PrefRow label="High-density plot decimation" hint="above ~10k rows, draw a min/max-reduced view that re-resolves on zoom">
        <Switch
          aria-label="Plot decimation"
          checked={decimateDensePlots}
          onChange={(v) => plotPerfPrefsSlot.save({ decimateDensePlots: v })}
        />
      </PrefRow>
      <PrefRow label="Toolbar group labels" hint="the small captions above the plot toolbar's button groups">
        <Switch
          aria-label="Toolbar group labels"
          checked={showGroupLabels}
          onChange={(v) => toolbarPrefsSlot.save({ ...toolbarPrefs, showGroupLabels: v })}
        />
      </PrefRow>
      <PrefRow label="Toolbar button labels" hint="a short text name beside each icon in the plot toolbar; off keeps the icon-only toolbar">
        <Switch
          aria-label="Toolbar button labels"
          checked={Boolean(toolbarPrefs.showButtonLabels)}
          onChange={(v) => toolbarPrefsSlot.save({ ...toolbarPrefs, showButtonLabels: v })}
        />
      </PrefRow>
    </>
  );
}
