// The Quick Figure Builder's "Right -- concise setup" panel (plans/
// LIBRARY_WORKBOOK_UX_PLAN.md, Quick Figure Builder concept): detected series,
// plot type, colour preset, lines/markers, axes, legend, and error-bar
// settings. Pure view over `QuickFigureSetup` (lib/quickFigureSetup.ts); the
// workspace owns the state, materializes it into the look the preview and the
// created figure share, and hands this panel the setters.

import type { ReactNode } from "react";

import { axisDisplayName } from "../../../lib/quickFigureMapping";
import type { QuickFigureMapping } from "../../../lib/quickFigureMapping";
import type { QuickPlotStyle } from "../../../lib/quickFigurePreview";
import { seriesXKey } from "../../../lib/quickFigureSeriesX";
import {
  LEGEND_CORNERS,
  LINE_STYLES,
  LINE_WIDTHS,
  MARKER_SHAPES,
  MARKER_SIZES,
  type QuickFigureSetup,
} from "../../../lib/quickFigureSetup";
import { PALETTES } from "../../../lib/palettes";
import type { Dataset } from "../../../lib/types";

interface Props {
  dataset: Dataset;
  mapping: QuickFigureMapping;
  style: QuickPlotStyle;
  onStyle: (style: QuickPlotStyle) => void;
  setup: QuickFigureSetup;
  onSetup: (patch: Partial<QuickFigureSetup>) => void;
}

function Field({ label, children, reason }: { label: string; children: ReactNode; reason?: string }) {
  return (
    <label className="qzk-quick-builder-field" title={reason}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange, disabled, reason }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  reason?: string;
}) {
  return (
    <label className="qzk-quick-setup-check" title={reason}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export default function QuickFigureSetupPanel({ dataset, mapping, style, onStyle, setup, onSetup }: Props) {
  const label = (ch: number | null) => (ch === null ? axisDisplayName(dataset, { ...mapping, xKey: null }) : dataset.data.labels[ch] ?? `col ${ch}`);
  const grouped = mapping.groupKey != null;
  const hasErrors = mapping.errorBindings.length > 0;
  const noLines = style === "scatter";
  const noMarkers = style === "line";
  const lineReason = noLines ? "Scatter draws points only, so line settings do not apply." : undefined;
  const markerReason = noMarkers ? "Markers apply to the Scatter and Line + symbol styles." : undefined;
  const errorReason = !hasErrors
    ? "Assign an X or Y error column first."
    : grouped
      ? "A grouped figure draws no error bars."
      : undefined;
  return (
    <div className="qzk-quick-setup">
      <div className="qzk-quick-setup-series" aria-label="Detected series">
        <span>Detected series</span>
        {mapping.yKeys.length === 0 ? (
          <p>None assigned yet.</p>
        ) : (
          <ul>
            {mapping.yKeys.map((y) => (
              <li key={y}>{`${label(y)} vs ${label(seriesXKey(mapping, y))}`}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="qzk-quick-setup-grid">
        <Field label="Plot style">
          <select value={style} onChange={(event) => onStyle(event.target.value as QuickPlotStyle)}>
            <option value="line">Line</option>
            <option value="scatter">Scatter</option>
            <option value="line-symbol">Line + symbol</option>
          </select>
        </Field>
        <Field label="Colour preset" reason={grouped ? "A grouped figure keeps the theme colour cycle so every level stays distinct." : undefined}>
          <select value={setup.palette} disabled={grouped} onChange={(event) => onSetup({ palette: event.target.value })}>
            {PALETTES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Line width" reason={lineReason}>
          <select value={setup.lineWidth} disabled={noLines} onChange={(event) => onSetup({ lineWidth: Number(event.target.value) })}>
            {LINE_WIDTHS.map((w) => <option key={w} value={w}>{w} px</option>)}
          </select>
        </Field>
        <Field label="Line style" reason={lineReason}>
          <select value={setup.lineStyle} disabled={noLines} onChange={(event) => onSetup({ lineStyle: event.target.value as QuickFigureSetup["lineStyle"] })}>
            {LINE_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Marker" reason={markerReason}>
          <select value={setup.markerShape} disabled={noMarkers} onChange={(event) => onSetup({ markerShape: event.target.value as QuickFigureSetup["markerShape"] })}>
            {MARKER_SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Marker size" reason={markerReason}>
          <select value={setup.markerSize} disabled={noMarkers} onChange={(event) => onSetup({ markerSize: Number(event.target.value) })}>
            {MARKER_SIZES.map((s) => <option key={s} value={s}>{s} px</option>)}
          </select>
        </Field>
        <Field label="X axis">
          <select value={setup.xScale} onChange={(event) => onSetup({ xScale: event.target.value as QuickFigureSetup["xScale"] })}>
            <option value="linear">Linear</option>
            <option value="log">Log</option>
          </select>
        </Field>
        <Field label="Y axis">
          <select value={setup.yScale} onChange={(event) => onSetup({ yScale: event.target.value as QuickFigureSetup["yScale"] })}>
            <option value="linear">Linear</option>
            <option value="log">Log</option>
          </select>
        </Field>
        <Field label="Legend">
          <select
            value={setup.showLegend ? setup.legendPos : "off"}
            onChange={(event) => {
              const value = event.target.value;
              onSetup(value === "off" ? { showLegend: false } : { showLegend: true, legendPos: value as QuickFigureSetup["legendPos"] });
            }}
          >
            {LEGEND_CORNERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            <option value="off">Hidden</option>
          </select>
        </Field>
        <div className="qzk-quick-setup-checks">
          <Check label="Grid" checked={setup.showGrid} onChange={(showGrid) => onSetup({ showGrid })} />
          <Check
            label="Error bars"
            checked={setup.errorBars && hasErrors && !grouped}
            disabled={errorReason !== undefined}
            reason={errorReason}
            onChange={(errorBars) => onSetup({ errorBars })}
          />
        </div>
      </div>
    </div>
  );
}
