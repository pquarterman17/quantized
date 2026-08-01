/**
 * Versioned canonical figure document (F1.2).
 *
 * This module defines the persistence boundary only. Stage/store integration,
 * legacy workspace migration, and the full reversible export adapters remain
 * separate campaign slices. Keeping this pure lets those migrations land
 * behind characterization tests instead of changing every surface at once.
 */
import type { ErrorBinding } from "./errorRoles";
import type { PlotMark } from "./plotspec";
import { snapshotView, type PlotView } from "./plotview";
import type { DataStruct } from "./types";

export const FIGURE_DOCUMENT_SCHEMA = "quantized.figure" as const;
export const FIGURE_DOCUMENT_VERSION = 1 as const;

/** Bindings have one owner; they are deliberately removed from visual state. */
export type FigureViewState = Omit<PlotView, "xKey" | "yKeys" | "y2Keys" | "errKeys">;

export interface FigureBindings {
  datasetId: string | null;
  xKey: number | null;
  yKeys: number[];
  y2Keys: number[];
  groupKey: number | null;
  facetKey: number | null;
  /** Canonical rich error roles: X/Y, symmetric, and asymmetric are representable. */
  errors: ErrorBinding[];
}

export interface FigureDataState {
  mode: "live" | "frozen";
  /** Required for frozen documents; absent for live documents. */
  snapshot?: DataStruct;
}

export interface FigurePlotState {
  mark: PlotMark;
  view: FigureViewState;
  /** Elided ranges stay editable even where today's renderer supports only X breaks. */
  axisBreaks: {
    x: [number, number][];
    y: [number, number][];
    y2: [number, number][];
  };
}

export interface FigureOutputSettings {
  format: string;
  stylePreset: string;
  dpi: number;
  transparent: boolean;
  filename: string | null;
}

export interface FigureDocumentV1 {
  schema: typeof FIGURE_DOCUMENT_SCHEMA;
  version: typeof FIGURE_DOCUMENT_VERSION;
  id: string;
  name: string;
  bindings: FigureBindings;
  data: FigureDataState;
  plot: FigurePlotState;
  output: FigureOutputSettings;
}

export type FigureDocument = FigureDocumentV1;

export interface CreateFigureDocumentInput {
  id: string;
  name: string;
  datasetId: string | null;
  view: PlotView;
  mark?: PlotMark;
  groupKey?: number | null;
  facetKey?: number | null;
  axisBreaks?: Partial<FigurePlotState["axisBreaks"]>;
  /** Prefer dataset ErrorBindings; legacy PlotView.errKeys are the fallback. */
  errors?: readonly ErrorBinding[];
  data?: FigureDataState;
  output?: Partial<FigureOutputSettings>;
}

const DEFAULT_OUTPUT: FigureOutputSettings = {
  format: "pdf",
  stylePreset: "default",
  dpi: 300,
  transparent: false,
  filename: null,
};

function legacyErrorBindings(errKeys: Readonly<Record<number, number>>): ErrorBinding[] {
  return Object.entries(errKeys).flatMap(([target, channel]) => {
    const targetKey = Number(target);
    return Number.isInteger(targetKey) && Number.isInteger(channel)
      ? [{ target: targetKey, channel, axis: "y" as const, side: "both" as const }]
      : [];
  });
}

/**
 * Pure seed adapter for new documents. It removes binding fields from the
 * visual state so later editors cannot accidentally create two authorities.
 */
export function createFigureDocument(input: CreateFigureDocumentInput): FigureDocumentV1 {
  const { xKey, yKeys, y2Keys, errKeys, ...view } = snapshotView(input.view);
  const data = input.data ?? { mode: "live" as const };
  if (data.mode === "frozen" && data.snapshot === undefined) {
    throw new Error("a frozen figure document requires a data snapshot");
  }
  if (data.mode === "live" && data.snapshot !== undefined) {
    throw new Error("a live figure document cannot own a frozen data snapshot");
  }

  return {
    schema: FIGURE_DOCUMENT_SCHEMA,
    version: FIGURE_DOCUMENT_VERSION,
    id: input.id,
    name: input.name,
    bindings: {
      datasetId: input.datasetId,
      xKey,
      yKeys: yKeys ?? [],
      y2Keys: y2Keys ?? [],
      groupKey: input.groupKey ?? null,
      facetKey: input.facetKey ?? null,
      errors: input.errors ? input.errors.map((binding) => ({ ...binding })) : legacyErrorBindings(errKeys),
    },
    data: data.snapshot === undefined ? { mode: data.mode } : { mode: data.mode, snapshot: data.snapshot },
    plot: {
      mark: input.mark ?? "line",
      view,
      axisBreaks: {
        x: input.axisBreaks?.x?.map((range) => [...range]) ?? [],
        y: input.axisBreaks?.y?.map((range) => [...range]) ?? [],
        y2: input.axisBreaks?.y2?.map((range) => [...range]) ?? [],
      },
    },
    output: {
      format: input.output?.format ?? DEFAULT_OUTPUT.format,
      stylePreset: input.output?.stylePreset ?? DEFAULT_OUTPUT.stylePreset,
      dpi: input.output?.dpi ?? DEFAULT_OUTPUT.dpi,
      transparent: input.output?.transparent ?? DEFAULT_OUTPUT.transparent,
      filename: input.output?.filename ?? DEFAULT_OUTPUT.filename,
    },
  };
}

/** Envelope check used to route future migrations without accepting versions we do not understand. */
export function figureDocumentVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  return candidate.schema === FIGURE_DOCUMENT_SCHEMA && Number.isInteger(candidate.version)
    ? candidate.version as number
    : null;
}
