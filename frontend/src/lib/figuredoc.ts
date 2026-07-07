// Figure documents (#12) + user graph templates (#15). A FigureDoc is a named
// figure in the workspace that re-opens, re-edits, and re-exports at any time:
// dataset ref (by id, never a copy — unless frozen), the full plot-state
// snapshot (channels/scales/labels), and the export config (#11's overrides
// object + preset/format/dpi). Live-linked docs render CURRENT data whenever
// opened (the builder reads live datasets, which the recalc graph keeps
// fresh); frozen docs carry their own data snapshot. A user graph template
// (#15) is the style half of a doc — preset + overrides + per-series styles —
// saved standalone and appliable to any figure. Pure.

import type { FigureOverrides } from "./figureOverrides";
import type { ExportSeriesStyle } from "./exportStyles";
import type { DataStruct } from "./types";

/** The builder configuration a FigureDoc restores (and a run re-exports). */
export interface FigureConfig {
  xKey: number | null;
  yKeys: number[] | null;
  xLog: boolean;
  yLog: boolean;
  title: string;
  xLabel: string;
  yLabel: string;
  style: string;
  fmt: string;
  dpi: number;
  overrides: FigureOverrides | null;
  seriesStyles: (ExportSeriesStyle | null)[] | null;
}

export interface FigureDoc {
  id: string;
  name: string;
  /** Source dataset (by id). Nulled if that dataset is removed — the doc then
   *  only renders if frozen. */
  datasetId: string | null;
  config: FigureConfig;
  /** true = render current data on open (default); false = frozen. */
  live: boolean;
  /** The data as-of freezing (present iff !live). */
  dataSnapshot?: DataStruct;
}

/** The style half of a config — what a user graph template (#15) carries. */
export interface GraphTemplate {
  name: string;
  style: string;
  overrides: FigureOverrides | null;
  seriesStyles: (ExportSeriesStyle | null)[] | null;
}

// ── .dwk sanitizers ─────────────────────────────────────────────────────────
function isConfig(v: unknown): v is FigureConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.style === "string" &&
    typeof o.fmt === "string" &&
    typeof o.title === "string" &&
    typeof o.xLog === "boolean" &&
    typeof o.yLog === "boolean"
  );
}

/** Validate persisted figure docs (drop malformed; clamp dead dataset refs —
 *  a live doc whose dataset vanished stays listed but renders disabled). */
export function sanitizeFigureDocs(v: unknown, dsIds: ReadonlySet<string>): FigureDoc[] {
  if (!Array.isArray(v)) return [];
  const out: FigureDoc[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string" || !isConfig(o.config)) continue;
    const datasetId =
      typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    const doc: FigureDoc = {
      id: o.id,
      name: o.name,
      datasetId,
      config: o.config,
      live: o.live !== false,
    };
    if (!doc.live && typeof o.dataSnapshot === "object" && o.dataSnapshot !== null) {
      doc.dataSnapshot = o.dataSnapshot as DataStruct;
    }
    out.push(doc);
  }
  return out;
}

/** A FigureDoc can render when its data source still exists. */
export function docRenderable(doc: FigureDoc): boolean {
  return doc.live ? doc.datasetId !== null : doc.dataSnapshot !== undefined;
}

// ── User graph templates (#15) — localStorage, like peak recipes ───────────
const KEY = "qz.graphTemplates";

function isTemplate(v: unknown): v is GraphTemplate {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.style === "string";
}

export function loadGraphTemplates(): GraphTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTemplate) : [];
  } catch {
    return [];
  }
}

/** Save (upsert by name) and return the new list. */
export function saveGraphTemplate(t: GraphTemplate): GraphTemplate[] {
  const list = loadGraphTemplates().filter((x) => x.name !== t.name);
  list.push(t);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — template stays session-local */
  }
  return list;
}

export function deleteGraphTemplate(name: string): GraphTemplate[] {
  const list = loadGraphTemplates().filter((x) => x.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
