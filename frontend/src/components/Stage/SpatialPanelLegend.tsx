// A read-only legend for one decoded spatial panel. The panel resolver owns
// the text/style/position contract; this component only renders it with the
// same swatch primitive as the ordinary PlotLegend, so line+symbol curves do
// not degrade to a line-only key in multi-panel Origin figures.

import { resolveDrawColor } from "../../lib/contrastColor";
import type { SeriesStyle } from "../../lib/types";
import { frameAnchorStyle } from "../../lib/uplotFrameVars";
import { RichText } from "../primitives";
import LegendSample from "./LegendSample";

export interface SpatialLegendEntry {
  label: string;
  style?: SeriesStyle;
  /** Index in this panel's DISPLAY order, used for the shared series palette. */
  displayIndex: number;
}

export interface SpatialPanelLegendProps {
  entries: SpatialLegendEntry[];
  title?: string;
  frameXY?: [number, number];
  isDarkBg?: boolean;
  inkColor?: string;
}

function swatchColor(
  entry: SpatialLegendEntry,
  isDarkBg: boolean,
  inkColor: string | undefined,
): string {
  const override = entry.style?.color;
  if (!override) return `var(--series-${(entry.displayIndex % 8) + 1})`;
  if (override.startsWith("--")) return `var(${override})`;
  return resolveDrawColor(override, isDarkBg, inkColor);
}

export default function SpatialPanelLegend({
  entries,
  title,
  frameXY,
  isDarkBg = true,
  inkColor,
}: SpatialPanelLegendProps) {
  if (!title && entries.length === 0) return null;
  return (
    <div
      className={`qzk-glass qzk-legend qzk-spatial-legend ${frameXY ? "" : "ne"}`}
      style={frameXY ? frameAnchorStyle(frameXY) : undefined}
      aria-label="Plot legend"
    >
      {title ? (
        <div className="it qzk-legend-title" style={{ fontWeight: 700 }}>
          <RichText text={title} />
        </div>
      ) : null}
      {entries.map((entry, i) => (
        <div className="it" key={`${entry.displayIndex}-${entry.label}-${i}`}>
          <LegendSample color={swatchColor(entry, isDarkBg, inkColor)} style={entry.style} />
          <RichText text={entry.label} />
        </div>
      ))}
    </div>
  );
}
