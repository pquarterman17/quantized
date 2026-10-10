import { signalRecipeLabel } from "./signalRecipe";
import type { Dataset } from "./types";

export const ANALYSIS_RESULT_VERSION = 1 as const;

export interface AnalysisResultProducer {
  id: string;
  label: string;
  version: number;
}

export interface AnalysisResultSource {
  datasetId: string;
  role: "input";
}

export interface AnalysisResultOutput {
  datasetId: string;
  role: "linked-worksheet";
}

export interface AnalysisResultSelection {
  datasetId: string;
  channels: { index: number; label: string; unit: string }[];
  xRange?: [number, number];
}

export type AnalysisResultValue = string | number | boolean | null | AnalysisResultValue[] | { [key: string]: AnalysisResultValue };

export interface AnalysisResultTable {
  title?: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export type AnalysisResultSettingsRef =
  | { datasetId: string; field: "analysisRecipe" | "peakTable" | "fitSpec" }
  | { datasetId: string; field: "reflFits"; recordId: string };

/** A durable catalog record for an analysis. Scientific output stays in its
 * established authority (for Signal Processing, the linked worksheet and its
 * `analysisRecipe`); this envelope points to that authority instead of
 * duplicating parameters or arrays that could drift. Producer ids are open,
 * so a newer build's result kind remains readable as a generic result. */
export interface AnalysisResult {
  version: typeof ANALYSIS_RESULT_VERSION;
  id: string;
  name: string;
  producer: AnalysisResultProducer;
  sources: AnalysisResultSource[];
  outputs: AnalysisResultOutput[];
  /** Read-only legacy field: early envelopes snapshotted the recipe's
   *  channels/X range, which drift when `bindSignalRecipe` rewrites the
   *  recipe. New envelopes omit it; the result workspace reads the linked
   *  output's `analysisRecipe` and falls back to this only without one. */
  selection?: AnalysisResultSelection;
  settingsRef?: AnalysisResultSettingsRef;
  scalarValues?: Record<string, number | string | null>;
  /** Producer settings that are themselves the durable authority. Unlike a
   *  settingsRef this contains no source arrays; statistical results use it
   *  to retain the exact question that produced their saved tables. */
  parameters?: Record<string, AnalysisResultValue>;
  /** Small, immutable result tables whose established authority is this
   *  envelope. Large numerical outputs remain linked worksheets via
   *  tableRefs so project files and the DOM stay bounded. */
  tables?: AnalysisResultTable[];
  tableRefs?: { datasetId: string; label: string }[];
  plotBindings?: { datasetId: string; channels: number[]; xChannel?: number | null }[];
  warnings: string[];
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  /** Save-time freshness (lib/analysisResultFreshness.ts): the sources' data
   *  fingerprint as of the output's last computation, and whether the output
   *  was known stale. Absent in files saved before them (read as current). */
  sourceFingerprint?: string;
  stale?: true;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return [...new Set(value)];
}

function sources(value: unknown): AnalysisResultSource[] | null {
  if (!Array.isArray(value)) return null;
  const out: AnalysisResultSource[] = [];
  for (const item of value) {
    const entry = object(item);
    if (!entry || typeof entry.datasetId !== "string" || entry.role !== "input") return null;
    if (!out.some((source) => source.datasetId === entry.datasetId)) {
      out.push({ datasetId: entry.datasetId, role: "input" });
    }
  }
  return out;
}

function outputs(value: unknown): AnalysisResultOutput[] | null {
  if (!Array.isArray(value)) return null;
  const out: AnalysisResultOutput[] = [];
  for (const item of value) {
    const entry = object(item);
    if (!entry || typeof entry.datasetId !== "string" || entry.role !== "linked-worksheet") return null;
    if (!out.some((output) => output.datasetId === entry.datasetId)) {
      out.push({ datasetId: entry.datasetId, role: "linked-worksheet" });
    }
  }
  return out;
}

function selection(value: unknown): AnalysisResultSelection | undefined {
  const raw = object(value);
  if (!raw || typeof raw.datasetId !== "string" || !Array.isArray(raw.channels)) return undefined;
  const channels: AnalysisResultSelection["channels"] = [];
  for (const value of raw.channels) {
    const channel = object(value);
    if (!channel || typeof channel.index !== "number" || !Number.isInteger(channel.index) || channel.index < 0 ||
        typeof channel.label !== "string" || typeof channel.unit !== "string") return undefined;
    channels.push({ index: channel.index, label: channel.label, unit: channel.unit });
  }
  const range = raw.xRange;
  const xRange = Array.isArray(range) && range.length === 2 && range.every((v) => typeof v === "number" && Number.isFinite(v)) && range[0] < range[1]
    ? [range[0], range[1]] as [number, number]
    : undefined;
  return { datasetId: raw.datasetId, channels, ...(xRange ? { xRange } : {}) };
}

function settingsRef(value: unknown): AnalysisResult["settingsRef"] {
  const raw = object(value);
  if (!raw || typeof raw.datasetId !== "string") return undefined;
  if (raw.field === "reflFits") {
    return typeof raw.recordId === "string" && raw.recordId
      ? { datasetId: raw.datasetId, field: raw.field, recordId: raw.recordId }
      : undefined;
  }
  return raw.field === "analysisRecipe" || raw.field === "peakTable" || raw.field === "fitSpec"
    ? { datasetId: raw.datasetId, field: raw.field }
    : undefined;
}

function scalarValues(value: unknown): AnalysisResult["scalarValues"] {
  const raw = object(value);
  if (!raw) return undefined;
  const out: NonNullable<AnalysisResult["scalarValues"]> = {};
  for (const [key, item] of Object.entries(raw)) {
    if ((typeof item === "number" && !Number.isFinite(item)) ||
        (typeof item !== "number" && typeof item !== "string" && item !== null)) return undefined;
    out[key] = item;
  }
  return out;
}

function resultValue(value: unknown, budget: { remaining: number }, depth = 0): AnalysisResultValue | undefined {
  if (depth > 8 || --budget.remaining < 0) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > 10_000) return undefined;
    const out: AnalysisResultValue[] = [];
    for (const item of value) {
      const parsed = resultValue(item, budget, depth + 1);
      if (parsed === undefined) return undefined;
      out.push(parsed);
    }
    return out;
  }
  const raw = object(value);
  if (!raw || Object.keys(raw).length > 256) return undefined;
  const out: Record<string, AnalysisResultValue> = {};
  for (const [key, item] of Object.entries(raw)) {
    const parsed = resultValue(item, budget, depth + 1);
    if (parsed === undefined) return undefined;
    out[key] = parsed;
  }
  return out;
}

function parameters(value: unknown): AnalysisResult["parameters"] {
  // Cap the aggregate tree as well as each collection. Without a shared
  // budget, a hand-edited project could stay below the per-object limit while
  // expanding into millions of nested values during sanitization.
  const parsed = resultValue(value, { remaining: 100_000 });
  return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : undefined;
}

/** Bounds on envelope-owned tables. Producers must cap to these (see
 *  statisticalTestAnalysisResult): the sanitizer rejects the whole list on
 *  reopen when any bound is exceeded. */
export const INLINE_TABLE_LIMITS = { tables: 32, columns: 256, rows: 10_000, cells: 100_000 } as const;

function tables(value: unknown): AnalysisResult["tables"] {
  const limits = INLINE_TABLE_LIMITS;
  if (!Array.isArray(value) || value.length > limits.tables) return undefined;
  const out: NonNullable<AnalysisResult["tables"]> = [];
  let cells = 0;
  for (const item of value) {
    const raw = object(item);
    if (!raw || !Array.isArray(raw.columns) || raw.columns.length > limits.columns ||
        !raw.columns.every((column) => typeof column === "string") ||
        !Array.isArray(raw.rows) || raw.rows.length > limits.rows) return undefined;
    cells += raw.columns.length * raw.rows.length;
    if (cells > limits.cells) return undefined;
    const rows: AnalysisResultTable["rows"] = [];
    for (const row of raw.rows) {
      if (!Array.isArray(row) || row.length !== raw.columns.length ||
          !row.every((cell) => cell === null || typeof cell === "string" ||
            (typeof cell === "number" && Number.isFinite(cell)))) return undefined;
      rows.push([...row] as AnalysisResultTable["rows"][number]);
    }
    out.push({
      ...(typeof raw.title === "string" && raw.title ? { title: raw.title } : {}),
      columns: [...raw.columns] as string[], rows,
    });
  }
  return out;
}

function tableRefs(value: unknown): AnalysisResult["tableRefs"] {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<AnalysisResult["tableRefs"]> = [];
  for (const item of value) {
    const entry = object(item);
    if (!entry || typeof entry.datasetId !== "string" || typeof entry.label !== "string") return undefined;
    out.push({ datasetId: entry.datasetId, label: entry.label });
  }
  return out;
}

function plotBindings(value: unknown): AnalysisResult["plotBindings"] {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<AnalysisResult["plotBindings"]> = [];
  for (const item of value) {
    const entry = object(item);
    if (!entry || typeof entry.datasetId !== "string" || !Array.isArray(entry.channels) ||
        !entry.channels.every((channel) => typeof channel === "number" && Number.isInteger(channel) && channel >= 0)) return undefined;
    const xChannel = entry.xChannel === null
      ? null
      : typeof entry.xChannel === "number" && Number.isInteger(entry.xChannel) && entry.xChannel >= 0
        ? entry.xChannel
        : undefined;
    out.push({
      datasetId: entry.datasetId,
      channels: [...new Set(entry.channels as number[])],
      ...(xChannel !== undefined || entry.xChannel === null ? { xChannel } : {}),
    });
  }
  return out;
}

/** Drop malformed records, preserve records from unknown producers, and never
 * clamp missing source ids: missing inputs are a diagnostic state the result
 * workspace must be able to explain. */
export function sanitizeAnalysisResults(value: unknown, warnings?: string[]): AnalysisResult[] {
  if (!Array.isArray(value)) return [];
  const out: AnalysisResult[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const raw = object(item);
    const producer = object(raw?.producer);
    const sourceRefs = sources(raw?.sources);
    const outputRefs = outputs(raw?.outputs);
    const warningList = strings(raw?.warnings);
    if (!raw || raw.version !== ANALYSIS_RESULT_VERSION || typeof raw.id !== "string" || !raw.id ||
        ids.has(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || !producer ||
        typeof producer.id !== "string" || !producer.id || typeof producer.label !== "string" ||
        typeof producer.version !== "number" || !Number.isInteger(producer.version) || producer.version < 1 ||
        sourceRefs === null || outputRefs === null || warningList === null ||
        typeof raw.createdAt !== "string" || !raw.createdAt) {
      if (raw && typeof raw.name === "string") warnings?.push(`analysis result "${raw.name}" could not be read and was dropped`);
      continue;
    }
    ids.add(raw.id);
    const selected = selection(raw.selection);
    const settings = settingsRef(raw.settingsRef);
    const scalars = scalarValues(raw.scalarValues);
    const savedParameters = parameters(raw.parameters);
    const inlineTables = tables(raw.tables);
    const savedTableRefs = tableRefs(raw.tableRefs);
    const plots = plotBindings(raw.plotBindings);
    out.push({
      version: ANALYSIS_RESULT_VERSION,
      id: raw.id,
      name: raw.name.trim(),
      producer: { id: producer.id, label: producer.label, version: producer.version },
      sources: sourceRefs,
      outputs: outputRefs,
      ...(selected ? { selection: selected } : {}),
      ...(settings ? { settingsRef: settings } : {}),
      ...(scalars ? { scalarValues: scalars } : {}),
      ...(savedParameters ? { parameters: savedParameters } : {}),
      ...(inlineTables ? { tables: inlineTables } : {}),
      ...(savedTableRefs ? { tableRefs: savedTableRefs } : {}),
      ...(plots ? { plotBindings: plots } : {}),
      warnings: warningList,
      createdAt: raw.createdAt,
      ...(typeof raw.updatedAt === "string" && raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
      ...(typeof raw.notes === "string" && raw.notes.trim() ? { notes: raw.notes } : {}),
      ...(typeof raw.sourceFingerprint === "string" && raw.sourceFingerprint ? { sourceFingerprint: raw.sourceFingerprint } : {}),
      ...(raw.stale === true ? { stale: true as const } : {}),
    });
  }
  return out;
}

export function signalAnalysisResult(
  id: string,
  source: Dataset,
  output: Dataset,
  createdAt = new Date().toISOString(),
): AnalysisResult | null {
  return output.derivedFrom?.datasetId === source.id ? signalEnvelope(id, source, output, createdAt) : null;
}

function signalEnvelope(
  id: string,
  source: Pick<Dataset, "id" | "name" | "errorRoles">,
  output: Dataset,
  createdAt: string,
): AnalysisResult | null {
  const recipe = output.analysisRecipe;
  if (!recipe) return null;
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `${signalRecipeLabel(recipe)} · ${source.name}`,
    producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }],
    outputs: [{ datasetId: output.id, role: "linked-worksheet" }],
    settingsRef: { datasetId: output.id, field: "analysisRecipe" },
    tableRefs: [{ datasetId: output.id, label: output.name }],
    plotBindings: [{ datasetId: output.id, channels: output.data.labels.map((_, index) => index) }],
    warnings: recipe.kind === "spectral" && (source.errorRoles?.length ?? 0) > 0
      ? ["Bound uncertainties were not propagated into this spectral output."]
      : [],
    createdAt,
  };
}

/** Migrate pre-result-envelope workspaces exactly once: callers invoke this
 * only when the top-level `analysisResults` key is absent. Deterministic ids
 * make repeated opens stable; an explicitly saved empty array stays empty.
 * An output whose source is not in the file KEEPS its result (owner
 * decision): the source ref names the missing id, and the result workspace
 * reports it as a missing-source diagnostic that clears if the source returns. */
export function migrateLegacySignalResults(datasets: readonly Dataset[], createdAt: string): AnalysisResult[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  return datasets.flatMap((output) => {
    const sourceId = output.derivedFrom?.datasetId;
    const source = sourceId === undefined ? undefined : byId.get(sourceId) ?? { id: sourceId, name: output.name };
    const result = source ? signalEnvelope(`analysis-${output.id}`, source, output, createdAt) : null;
    return result ? [result] : [];
  });
}
