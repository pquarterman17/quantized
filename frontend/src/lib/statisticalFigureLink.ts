import { analysisDataFingerprint } from "./analysisResultFreshness";
import { groupLevelLabel } from "./categorical";
import type { FigureDocument } from "./figureDocument";
import { analysisRowIds } from "./rowstate";
import type { StatisticalFigureLinkDescriptor } from "./statisticalFigureLinkTypes";
import type { Dataset } from "./types";

export interface StatisticalFigureLink {
  sourceId: string;
  figureDatasetId: string;
  rowsByFigureRow: number[][];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const columnIsValid = (source: Dataset, value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= -1 && (value as number) < source.data.labels.length;
const valueAt = (source: Dataset, column: number, row: number): number =>
  column < 0 ? source.data.time[row] : source.data.values[row]?.[column];

function descriptorFrom(
  raw: unknown,
  source: Dataset,
  figureRows: number,
): StatisticalFigureLinkDescriptor | null {
  if (!record(raw) || typeof raw.kind !== "string") return null;
  if (raw.kind === "direct") {
    if (!Array.isArray(raw.rows) || raw.rows.length !== figureRows ||
        !raw.rows.every((row) => Number.isInteger(row) && (row as number) >= -1 && (row as number) < source.data.time.length)) return null;
    return { kind: "direct", rows: raw.rows as number[] };
  }
  if (!columnIsValid(source, raw.responseColumn)) return null;
  if (raw.kind === "match") {
    if (!Array.isArray(raw.rows) || raw.rows.length !== figureRows) return null;
    const rows = raw.rows.map((rawRow) => {
      if (!record(rawRow) || !Array.isArray(rawRow.levels) || rawRow.levels.length > source.data.labels.length + 1) return null;
      const levels = rawRow.levels.map((term) => Array.isArray(term) && term.length === 2 &&
        columnIsValid(source, term[0]) && typeof term[1] === "string"
        ? [term[0], term[1]] as [number, string] : null);
      return levels.some((term) => term === null)
        ? null : { levels: levels as [number, string][] };
    });
    return rows.some((row) => row === null) ? null
      : { kind: "match", responseColumn: raw.responseColumn, rows: rows as Extract<StatisticalFigureLinkDescriptor, { kind: "match" }>["rows"] };
  }
  if (raw.kind !== "histogram" || !Array.isArray(raw.bins) || raw.bins.length !== figureRows) return null;
  const bins = raw.bins.map((bin) => Array.isArray(bin) && bin.length === 2 && finite(bin[0]) &&
    finite(bin[1]) && bin[0] < bin[1] ? [bin[0], bin[1]] as [number, number] : null);
  if (bins.some((bin) => bin === null)) return null;
  let level: { column: number; label: string } | undefined;
  if (raw.level !== undefined) {
    if (!record(raw.level) || !columnIsValid(source, raw.level.column) || typeof raw.level.label !== "string") return null;
    level = { column: raw.level.column, label: raw.level.label };
  }
  return {
    kind: "histogram", responseColumn: raw.responseColumn,
    ...(level ? { level } : {}), bins: bins as [number, number][],
  };
}

const candidatesOf = (source: Dataset): number[] =>
  analysisRowIds(source) ?? Array.from({ length: source.data.time.length }, (_, row) => row);

function rowsForDescriptor(source: Dataset, descriptor: StatisticalFigureLinkDescriptor): number[][] {
  const candidates = candidatesOf(source);
  if (descriptor.kind === "direct") {
    const included = new Set(candidates);
    return descriptor.rows.map((row) => row >= 0 && included.has(row) ? [row] : []);
  }
  if (descriptor.kind === "match") return descriptor.rows.map(({ levels }) => candidates.filter((row) => {
    if (!finite(valueAt(source, descriptor.responseColumn, row))) return false;
    return levels.every(([column, wanted]) => {
      const value = valueAt(source, column, row);
      return finite(value) && groupLevelLabel(source.data, column, value) === wanted;
    });
  }));
  const out = descriptor.bins.map(() => [] as number[]);
  for (const row of candidates) {
    const value = valueAt(source, descriptor.responseColumn, row);
    if (!finite(value)) continue;
    if (descriptor.level) {
      const group = valueAt(source, descriptor.level.column, row);
      if (!finite(group) || groupLevelLabel(source.data, descriptor.level.column, group) !== descriptor.level.label) continue;
    }
    const bin = descriptor.bins.findIndex(([left, right], index) => value >= left &&
      (value < right || (index === descriptor.bins.length - 1 && value <= right)));
    if (bin >= 0) out[bin].push(row);
  }
  return out;
}

/** Resolve a frozen statistical figure's optional live source-row bridge.
 * The immutable snapshot remains renderable when this fails closed: missing,
 * pending, changed, or malformed source state only disables linked brushing. */
export function resolveStatisticalFigureLink(
  figure: FigureDocument | null | undefined,
  datasets: readonly Dataset[],
  figureDatasetId: string,
): StatisticalFigureLink | null {
  const snapshot = figure?.data.mode === "frozen" ? figure.data.snapshot : undefined;
  if (!snapshot) return null;
  const { sourceDatasetId, sourceFingerprint, analysisSourceLink } = snapshot.metadata;
  if (typeof sourceDatasetId !== "string" || typeof sourceFingerprint !== "string") return null;
  const source = datasets.find((dataset) => dataset.id === sourceDatasetId);
  if (!source || source.pending || analysisDataFingerprint(source) !== sourceFingerprint) return null;
  const descriptor = descriptorFrom(analysisSourceLink, source, snapshot.time.length);
  if (!descriptor) return null;
  return { sourceId: source.id, figureDatasetId, rowsByFigureRow: rowsForDescriptor(source, descriptor) };
}

export function sourceRowsForFigureRows(link: StatisticalFigureLink, figureRows: readonly number[]): number[] {
  return [...new Set(figureRows.flatMap((row) => link.rowsByFigureRow[row] ?? []))].sort((a, b) => a - b);
}

export function figureRowsForSourceRows(link: StatisticalFigureLink, sourceRows: readonly number[]): number[] {
  const selected = new Set(sourceRows);
  return link.rowsByFigureRow.flatMap((rows, figureRow) => rows.some((row) => selected.has(row)) ? [figureRow] : []);
}
