// Lightweight, runtime-safe plot-recipe schema. Workspace parsing needs the
// version constant and these shapes during application startup, but it does not
// need plotRecipe.ts's capture implementation. Keeping this module free of
// value imports prevents workspace.ts -> plotRecipeIO.ts from pulling capture,
// error-role inference, and figure-document helpers into the eager bundle.

import type { CompositionKind } from "./composition";
import type { ErrorSide } from "./errorRoles";
import type { LegendPos } from "./plotview";
import type { PlotMark } from "./plotspec";
import type { SignatureErrorRole } from "./quickPlotTemplates";
import type {
  Annotation,
  AxisFormat,
  AxisScale,
  RegionShade,
  SeriesStyle,
  Shape,
  Technique,
} from "./types";

export const PLOT_RECIPE_SCHEMA_VERSION = 1 as const;

export type RecipeChannelRole = "x" | "y" | "y2" | "group" | "facet" | "error";

export interface RecipeSignatureEntry {
  id: string;
  role: RecipeChannelRole;
  label: string;
  unit: string;
  errorRole: SignatureErrorRole;
  aliases: string[];
}

export interface RecipeErrorBinding {
  channel: string;
  target: string | null;
  axis: "x" | "y";
  side: ErrorSide;
}

export interface RecipeMapping {
  xId: string | null;
  yIds: string[];
  y2Ids: string[];
  groupId: string | null;
  facetId: string | null;
  errors: RecipeErrorBinding[];
}

export type RecipeAxisRange = { mode: "auto" } | { mode: "fixed"; lim: [number, number]; step?: number };

export interface RecipeAxisBreaks {
  x: [number, number][];
  y: [number, number][];
  y2: [number, number][];
}

export interface RecipeDecorations {
  annotations: Annotation[];
  shapes: Shape[];
  regionShades: RegionShade[];
}

export interface RecipeVisual {
  mark: PlotMark;
  xScale: AxisScale;
  yScale: AxisScale;
  y2Scale: AxisScale | null;
  xRange: RecipeAxisRange;
  yRange: RecipeAxisRange;
  y2Range: RecipeAxisRange;
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  y2Fmt: AxisFormat | null;
  axisBreaks: RecipeAxisBreaks;
  showLegend: boolean;
  legendPos: LegendPos;
  legendXY: [number, number] | null;
  legendTitle: string | null;
  legendStatic: boolean;
  stackMode: boolean;
  waterfall: number;
  plotTemplate: string;
  seriesStyles: Record<string, SeriesStyle>;
  seriesLabels: Record<string, string>;
  seriesOrder: string[] | null;
  hiddenChannels: string[];
  decorations: RecipeDecorations;
  compositionKind: CompositionKind | null;
}

export interface PlotRecipeProvenance {
  sourceDatasetLabel: string;
  appVersion: string;
}

export interface PlotRecipe {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  modifiedAt: string;
  schemaVersion: typeof PLOT_RECIPE_SCHEMA_VERSION;
  provenance: PlotRecipeProvenance;
  technique: Technique;
  signature: RecipeSignatureEntry[];
  mapping: RecipeMapping;
  visual: RecipeVisual;
}
