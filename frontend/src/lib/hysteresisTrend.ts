import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import { defaultPlotView } from "./plotview";
import type { StatisticalResultFigureDraft } from "./statisticalResultFigures";
import type { DataStruct, Dataset } from "./types";

export interface HysteresisTrendCandidate {
  key: string;
  label: string;
  coverage: number;
  values: Record<string, number>;
  units: string[];
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Accept a scalar number or an explicitly numeric metadata string. Empty,
 * boolean, array, and object values never become accidental series values. */
export function numericMetadataValue(value: unknown): number | null {
  if (finite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function metadataLabel(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const likelySeries = /(temp|field|angle|thick|pressure|time|dose|concentration|composition|bias|current|voltage)/i;

function internalMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "x_column_index" || normalized === "y_column_index" ||
    normalized.startsWith("startup_axis_") || normalized.startsWith("default_") ||
    normalized.startsWith("parser_") || normalized.startsWith("schema_") ||
    normalized.endsWith("_column_index");
}

function stableColumnValue(dataset: Dataset, column: number): number | null {
  let count = 0, sum = 0, lo = Number.POSITIVE_INFINITY, hi = Number.NEGATIVE_INFINITY;
  for (const row of dataset.data.values) {
    const value = row[column];
    if (!finite(value)) continue;
    count += 1;
    sum += value;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  if (count < 2 || count < dataset.data.values.length * 0.8) return null;
  const mean = sum / count;
  const tolerance = Math.max(0.1, Math.max(Math.abs(mean), Math.abs(lo), Math.abs(hi)) * 1e-3);
  return hi - lo <= tolerance ? mean : null;
}

/** Numeric metadata plus nearly constant scientific companion columns available
 * on reviewed worksheets. Internal parser coordinates are intentionally hidden;
 * filename text is never a candidate. */
export function hysteresisTrendCandidates(datasets: readonly Dataset[]): HysteresisTrendCandidate[] {
  const candidates = new Map<string, HysteresisTrendCandidate>();
  const add = (key: string, label: string, datasetId: string, value: number, unit: string): void => {
    const candidate = candidates.get(key) ?? { key, label, coverage: 0, values: {}, units: [] };
    if (!Object.hasOwn(candidate.values, datasetId)) candidate.coverage += 1;
    candidate.values[datasetId] = value;
    if (unit && !candidate.units.includes(unit)) candidate.units.push(unit);
    candidates.set(key, candidate);
  };
  for (const dataset of datasets) {
    for (const [key, value] of Object.entries(dataset.data.metadata ?? {})) {
      const numeric = numericMetadataValue(value);
      if (numeric !== null && !internalMetadataKey(key)) {
        add(`metadata:${key}`, metadataLabel(key), dataset.id, numeric, metadataUnit([dataset], key));
      }
    }
    dataset.data.labels.forEach((label, column) => {
      if (!likelySeries.test(label)) return;
      const value = stableColumnValue(dataset, column);
      if (value === null) return;
      const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      add(`column:${normalized}`, label.trim() || `Column ${column + 1}`, dataset.id, value, dataset.data.units[column] ?? "");
    });
  }
  for (const candidate of candidates.values()) {
    candidate.units.sort((left, right) => left.localeCompare(right));
  }
  return [...candidates.values()]
    .sort((left, right) => Number(likelySeries.test(right.label)) - Number(likelySeries.test(left.label)) ||
      right.coverage - left.coverage || left.label.localeCompare(right.label))
    .slice(0, 100);
}

/** Use a companion metadata unit only when every declared value agrees. A
 * blank return is deliberate: units are never guessed from a key name. */
export function metadataUnit(datasets: readonly Dataset[], key: string): string {
  const units = metadataUnits(datasets, key);
  return units.length === 1 ? units[0] : "";
}

export function metadataUnits(datasets: readonly Dataset[], key: string): string[] {
  const candidates = new Set([`${key}_unit`, `${key} unit`, `${key}Unit`]
    .map((candidate) => candidate.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  const units = new Set<string>();
  for (const dataset of datasets) {
    for (const [candidate, value] of Object.entries(dataset.data.metadata ?? {})) {
      const normalized = candidate.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (candidates.has(normalized) && typeof value === "string" && value.trim()) units.add(value.trim());
    }
  }
  return [...units].sort((left, right) => left.localeCompare(right));
}

interface TrendAxis {
  label: string;
  unit: string;
  column: string;
}

function trendAxis(result: AnalysisResult): TrendAxis | null {
  if (result.producer.id !== "analysis-batch" || result.parameters?.toolId !== "hysteresis") return null;
  const raw = result.parameters.hysteresisTrend;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const label = raw.label, unit = raw.unit, column = raw.column;
  return typeof label === "string" && label.trim() && typeof unit === "string" &&
    typeof column === "string" && column.trim()
    ? { label: label.trim(), unit: unit.trim(), column: column.trim() } : null;
}

function columnIndex(table: AnalysisResultTable, label: string): number | null {
  const index = table.columns.indexOf(label);
  return index < 0 ? null : index;
}

interface MetricGroup {
  key: string;
  title: string;
  metrics: string[];
  unitColumn: string | null;
}

const METRIC_GROUPS: readonly MetricGroup[] = [
  { key: "fields", title: "Hysteresis fields", metrics: ["Mean |Hc|", "SFD peak H"], unitColumn: "H unit" },
  { key: "moments", title: "Magnetic response", metrics: ["Mean |Mr|", "Mean |Ms|"], unitColumn: "M unit" },
  { key: "squareness", title: "Squareness", metrics: ["Squareness"], unitColumn: null },
  { key: "loop-area", title: "Loop area", metrics: ["Loop area"], unitColumn: "Area unit" },
];

const unitKey = (unit: string): string => unit.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "undeclared";

/** Frozen editable trend figures from the exact saved batch table. A figure is
 * created only for an explicit numeric series axis and at least two completed
 * finite points. Different physical units are never placed on one Y scale. */
export function hysteresisBatchResultFigures(result: AnalysisResult): StatisticalResultFigureDraft[] {
  const axis = trendAxis(result);
  const table = result.tables?.find((candidate) => candidate.title === "Batch status");
  if (!axis || !table) return [];
  const xIndex = columnIndex(table, axis.column);
  const statusIndex = columnIndex(table, "Status");
  if (xIndex === null || statusIndex === null) return [];
  const completed = table.rows.filter((row) => row[statusIndex] === "Completed" && finite(row[xIndex]));
  const drafts: StatisticalResultFigureDraft[] = [];
  const usedKeys = new Set<string>();
  for (const group of METRIC_GROUPS) {
    const metricColumns = group.metrics.map((label) => ({ label, index: columnIndex(table, label) }))
      .filter((entry): entry is { label: string; index: number } => entry.index !== null);
    if (!metricColumns.length) continue;
    const groupUnitIndex = group.unitColumn ? columnIndex(table, group.unitColumn) : null;
    const byUnit = new Map<string, typeof completed>();
    for (const row of completed) {
      const unit = groupUnitIndex === null ? "" : typeof row[groupUnitIndex] === "string" ? row[groupUnitIndex].trim() : "";
      const rows = byUnit.get(unit);
      if (rows) rows.push(row);
      else byUnit.set(unit, [row]);
    }
    for (const [unit, unitRows] of byUnit) {
      const series = metricColumns.filter((metric) =>
        unitRows.filter((row) => finite(row[metric.index])).length >= 2);
      if (!series.length) continue;
      const rows = unitRows.filter((row) => series.some((metric) => finite(row[metric.index])))
        .sort((left, right) => (left[xIndex] as number) - (right[xIndex] as number));
      if (rows.length < 2) continue;
      const data: DataStruct = {
        time: rows.map((row) => row[xIndex] as number),
        values: rows.map((row) => series.map((metric) => finite(row[metric.index]) ? row[metric.index] as number : Number.NaN)),
        labels: series.map((metric) => metric.label),
        units: series.map(() => unit),
        metadata: {
          frozenFromAnalysisResult: true,
          x_column_name: axis.label,
          x_column_unit: axis.unit,
        },
      };
      const suffix = unit ? ` (${unit})` : "";
      const title = `${group.title}${suffix} vs ${axis.label}`;
      const keyBase = `hysteresis-${group.key}-${unitKey(unit)}`;
      let key = keyBase, disambiguator = 2;
      while (usedKeys.has(key)) key = `${keyBase}-${disambiguator++}`;
      usedKeys.add(key);
      drafts.push({
        key,
        name: title,
        description: `${group.title} across completed loop analyses using the explicitly recorded ${axis.label} values${unit ? `; Y units are ${unit}` : "; Y units were not declared"}.`,
        data,
        mark: "line",
        view: {
          ...defaultPlotView(),
          plotTitle: title,
          xAxisLabel: axis.unit ? `${axis.label} (${axis.unit})` : axis.label,
          yAxisLabel: `${group.title}${suffix}`,
          xKey: null,
          yKeys: series.map((_metric, index) => index),
          showLegend: series.length > 1,
          seriesStyles: Object.fromEntries(series.map((_metric, index) => [index, {
            width: 2, marker: true, markerSize: 6, explicit: true,
          }])),
        },
      });
      if (drafts.length >= 24) return drafts;
    }
  }
  return drafts;
}
