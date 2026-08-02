/**
 * Versioned canonical figure document (F1.2).
 *
 * This module defines the persistence boundary only. Stage/store integration,
 * legacy workspace migration, and the full reversible export adapters remain
 * separate campaign slices. Keeping this pure lets those migrations land
 * behind characterization tests instead of changing every surface at once.
 */
import { errKeysFromBindings, type ErrorBinding } from "./errorRoles";
import { sanitizeFigureOverrides, type FigureOverrides } from "./figureOverrides";
import { sanitizeExportSeriesStyles, type ExportSeriesStyle } from "./publicationStyles";
import { PLOT_MARKS, type PlotMark } from "./plotspec";
import { sanitizePlotView, snapshotView, type PlotView } from "./plotview";
import type { DataStruct } from "./types";

export const FIGURE_DOCUMENT_SCHEMA = "quantized.figure" as const;
export const FIGURE_DOCUMENT_VERSION = 2 as const;

/** Bindings have one owner; they are deliberately removed from visual state. */
export type FigureViewState = Omit<PlotView, "xKey" | "yKeys" | "y2Keys" | "errKeys">;

export interface FigureBindings {
  datasetId: string | null;
  xKey: number | null;
  /** null preserves PlotView's “automatic/all channels” selection sentinel. */
  yKeys: number[] | null;
  y2Keys: number[] | null;
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

/** F1's persisted shape. v2 adds `publication`; this remains migration input only. */
export interface FigureDocumentV1 {
  schema: typeof FIGURE_DOCUMENT_SCHEMA;
  version: 1;
  id: string;
  name: string;
  bindings: FigureBindings;
  data: FigureDataState;
  plot: FigurePlotState;
  output: FigureOutputSettings;
}

/** Exact publication-only settings that PlotView cannot represent. */
export interface FigurePublicationState {
  /** Raw backend overrides; absent publication means derive only from canonical PlotView. */
  overrides: FigureOverrides | null;
  /** Absent derives styles from PlotView; null omits them; an array is exact. */
  seriesStyles?: (ExportSeriesStyle | null)[] | null;
}

export interface FigureDocumentV2 extends Omit<FigureDocumentV1, "version"> {
  version: typeof FIGURE_DOCUMENT_VERSION;
  /** Absent on migrated v1 documents, preserving canonical-only render derivation. */
  publication?: FigurePublicationState;
}

export type FigureDocument = FigureDocumentV2;

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
  publication?: FigurePublicationState;
}

const DEFAULT_OUTPUT: FigureOutputSettings = {
  format: "pdf",
  stylePreset: "default",
  dpi: 300,
  transparent: false,
  filename: null,
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

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
export function createFigureDocument(input: CreateFigureDocumentInput): FigureDocument {
  const { xKey, yKeys, y2Keys, errKeys, ...view } = clone(snapshotView(input.view));
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
      yKeys,
      y2Keys,
      groupKey: input.groupKey ?? null,
      facetKey: input.facetKey ?? null,
      errors: input.errors ? clone([...input.errors]) : legacyErrorBindings(errKeys),
    },
    data: data.snapshot === undefined ? { mode: data.mode } : { mode: data.mode, snapshot: clone(data.snapshot) },
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
    ...(input.publication === undefined ? {} : { publication: clone(input.publication) }),
  };
}

/** Project a document into today's focused-window facade without mutating it. */
export function figureDocumentToPlotView(document: FigureDocument): PlotView {
  return {
    ...clone(document.plot.view),
    xKey: document.bindings.xKey,
    yKeys: clone(document.bindings.yKeys),
    y2Keys: clone(document.bindings.y2Keys),
    errKeys: errKeysFromBindings(document.bindings.errors),
  };
}

export interface UpdateFigureDocumentInput {
  view: PlotView;
  name?: string;
  datasetId?: string | null;
}

/** Commit the focused PlotView facade back into its canonical document. */
export function updateFigureDocumentFromPlotView(
  document: FigureDocument,
  input: UpdateFigureDocumentInput,
): FigureDocument {
  // The legacy facade can edit only symmetric Y errors. Preserve richer X and
  // asymmetric roles while replacing the projection it can actually control.
  const richErrors = document.bindings.errors.filter(
    (binding) => binding.axis !== "y" || binding.side !== "both",
  );
  return createFigureDocument({
    id: document.id,
    name: input.name ?? document.name,
    datasetId: input.datasetId === undefined ? document.bindings.datasetId : input.datasetId,
    view: input.view,
    mark: document.plot.mark,
    groupKey: document.bindings.groupKey,
    facetKey: document.bindings.facetKey,
    errors: [...richErrors, ...legacyErrorBindings(input.view.errKeys)],
    data: document.data,
    axisBreaks: document.plot.axisBreaks,
    output: document.output,
    publication: document.publication,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}

function integerList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item) && item >= 0)
    : [];
}

function integerListOrNull(value: unknown): number[] | null {
  return value === null ? null : integerList(value);
}

function errorBindings(value: unknown): ErrorBinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ErrorBinding[] => {
    if (!isObject(candidate)) return [];
    const { channel, target, axis, side } = candidate;
    if (!Number.isInteger(channel) || (channel as number) < 0) return [];
    if (!Number.isInteger(target) || (target as number) < -1) return [];
    if (axis !== "x" && axis !== "y") return [];
    if (side !== "both" && side !== "+" && side !== "-") return [];
    return [{ channel: channel as number, target: target as number, axis, side }];
  });
}

function axisBreaks(value: unknown): FigurePlotState["axisBreaks"] {
  const object = isObject(value) ? value : {};
  const ranges = (candidate: unknown): [number, number][] =>
    Array.isArray(candidate)
      ? candidate.flatMap((range): [number, number][] =>
          Array.isArray(range) && range.length === 2 &&
          Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] < range[1]
            ? [[range[0], range[1]]]
            : [])
      : [];
  return { x: ranges(object.x), y: ranges(object.y), y2: ranges(object.y2) };
}

/** Restore a frozen JSON snapshot without weakening the runtime DataStruct
 * type. JSON.stringify turns every NaN/+Infinity/-Infinity cell into null;
 * those nulls are therefore normalized to NaN (the original kind/sign is not
 * recoverable). Any other non-number cell remains invalid and rejects only
 * this frozen document, not the surrounding workspace. */
function normalizeFrozenDataStruct(value: unknown): DataStruct | null {
  if (!isObject(value) || !isObject(value.metadata)) return null;
  const cells = (candidate: unknown): number[] | null => {
    if (!Array.isArray(candidate)) return null;
    const out: number[] = [];
    for (const cell of candidate) {
      if (cell === null) out.push(Number.NaN);
      else if (typeof cell === "number") out.push(Number.isFinite(cell) ? cell : Number.NaN);
      else return null;
    }
    return out;
  };
  const time = cells(value.time);
  if (!time || !Array.isArray(value.values)) return null;
  const values: number[][] = [];
  for (const row of value.values) {
    const normalized = cells(row);
    if (!normalized) return null;
    values.push(normalized);
  }
  if (
    !Array.isArray(value.labels) || !value.labels.every((item) => typeof item === "string") ||
    !Array.isArray(value.units) || !value.units.every((item) => typeof item === "string")
  ) return null;
  return {
    ...(clone(value) as unknown as DataStruct),
    time,
    values,
    labels: [...value.labels],
    units: [...value.units],
    metadata: clone(value.metadata),
  };
}

function figureView(value: unknown, bindings: FigureBindings): FigureViewState {
  const sanitized = sanitizePlotView({
    ...(isObject(value) ? value : {}),
    xKey: bindings.xKey,
    yKeys: bindings.yKeys,
    y2Keys: bindings.y2Keys,
    errKeys: errKeysFromBindings(bindings.errors),
  });
  const { xKey: _xKey, yKeys: _yKeys, y2Keys: _y2Keys, errKeys: _errKeys, ...view } = sanitized;
  return clone(view);
}

function publicationState(value: unknown): FigurePublicationState | undefined {
  if (!isObject(value)) return undefined;
  const overrides = value.overrides === null ? null : sanitizeFigureOverrides(value.overrides);
  if (!("seriesStyles" in value)) return { overrides };
  const seriesStyles = value.seriesStyles === null ? null : sanitizeExportSeriesStyles(value.seriesStyles);
  return { overrides, seriesStyles };
}

/**
 * Validate an untrusted persisted document. Malformed optional fields degrade
 * to safe defaults; a bad envelope, identity, data mode, or frozen snapshot
 * rejects the whole document.
 */
export function sanitizeFigureDocument(value: unknown): FigureDocument | null {
  if (
    !isObject(value) ||
    value.schema !== FIGURE_DOCUMENT_SCHEMA ||
    (value.version !== 1 && value.version !== FIGURE_DOCUMENT_VERSION)
  ) return null;
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string") return null;
  if (!isObject(value.bindings) || !isObject(value.data) || !isObject(value.plot)) return null;

  const rawBindings = value.bindings;
  const datasetId = typeof rawBindings.datasetId === "string" || rawBindings.datasetId === null
    ? rawBindings.datasetId
    : null;
  const bindings: FigureBindings = {
    datasetId,
    xKey: integerOrNull(rawBindings.xKey),
    yKeys: integerListOrNull(rawBindings.yKeys),
    y2Keys: integerListOrNull(rawBindings.y2Keys),
    groupKey: integerOrNull(rawBindings.groupKey),
    facetKey: integerOrNull(rawBindings.facetKey),
    errors: errorBindings(rawBindings.errors),
  };

  const mode = value.data.mode;
  if (mode !== "live" && mode !== "frozen") return null;
  if (mode === "live" && value.data.snapshot !== undefined) return null;
  const frozenSnapshot = mode === "frozen" ? normalizeFrozenDataStruct(value.data.snapshot) : null;
  if (mode === "frozen" && !frozenSnapshot) return null;

  const mark = PLOT_MARKS.includes(value.plot.mark as PlotMark) ? value.plot.mark as PlotMark : "line";
  const rawOutput = isObject(value.output) ? value.output : {};
  const dpi = typeof rawOutput.dpi === "number" && Number.isFinite(rawOutput.dpi) && rawOutput.dpi > 0
    ? rawOutput.dpi
    : DEFAULT_OUTPUT.dpi;

  const migratedPublication = value.version === FIGURE_DOCUMENT_VERSION
    ? publicationState(value.publication)
    : undefined;
  return {
    schema: FIGURE_DOCUMENT_SCHEMA,
    version: FIGURE_DOCUMENT_VERSION,
    id: value.id,
    name: value.name,
    bindings,
    data: mode === "frozen"
      ? { mode, snapshot: frozenSnapshot! }
      : { mode },
    plot: {
      mark,
      view: figureView(value.plot.view, bindings),
      axisBreaks: axisBreaks(value.plot.axisBreaks),
    },
    output: {
      format: typeof rawOutput.format === "string" ? rawOutput.format : DEFAULT_OUTPUT.format,
      stylePreset: typeof rawOutput.stylePreset === "string" ? rawOutput.stylePreset : DEFAULT_OUTPUT.stylePreset,
      dpi,
      transparent: typeof rawOutput.transparent === "boolean" ? rawOutput.transparent : DEFAULT_OUTPUT.transparent,
      filename: typeof rawOutput.filename === "string" || rawOutput.filename === null
        ? rawOutput.filename
        : DEFAULT_OUTPUT.filename,
    },
    ...(migratedPublication === undefined ? {} : { publication: migratedPublication }),
  };
}

export function serializeFigureDocument(document: FigureDocument): string {
  return JSON.stringify(document);
}

export function deserializeFigureDocument(raw: string): FigureDocument | null {
  try {
    return sanitizeFigureDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Envelope check used to route future migrations without accepting versions we do not understand. */
export function figureDocumentVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  return candidate.schema === FIGURE_DOCUMENT_SCHEMA && Number.isInteger(candidate.version)
    ? candidate.version as number
    : null;
}
