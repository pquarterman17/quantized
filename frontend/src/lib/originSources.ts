// Exact, loss-aware source bindings for imported Origin figures (#50).
// Pure resolver: no store/UI/fetch. Every match is scoped to siblingIds from
// the same import, and every missing book/column is retained as diagnostics.

import { originErrKeys } from "./errorbars";
import { figureLayerFamily, type OriginFigureEntry } from "./originFigures";
import type { Dataset, OriginCurve } from "./types";

export interface OriginSourceBinding {
  datasetId: string;
  book: string;
  /** Worksheet numbering: -1 is the pinned time/X column. */
  xColumns: number[];
  yColumns: number[];
  errorColumns: number[];
  /** Combined X/Y/error selection, in curve order with duplicates removed. */
  columns: number[];
}

export interface UnresolvedOriginBinding {
  book: string;
  x: string;
  y: string;
  reason:
    | "book_not_imported"
    | "x_column_not_decoded"
    | "y_column_not_decoded"
    | "x_column_has_no_numeric_data"
    | "y_column_has_no_numeric_data";
}

export interface OriginSourceResolution {
  sources: OriginSourceBinding[];
  unresolved: UnresolvedOriginBinding[];
}

export interface OriginSourceMappingPreview {
  book: string;
  datasetId: string;
  entryIds: string[];
  bindingCount: number;
  incompatible: UnresolvedOriginBinding[];
  canApply: boolean;
}

function channelOf(ds: Dataset, letter: string): number | null {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  if (!letter || letter === String(meta.x_column_name ?? "")) return -1;
  const letters = Array.isArray(meta.origin_column_names)
    ? (meta.origin_column_names as unknown[]).map(String)
    : [];
  const channel = letters.indexOf(letter);
  return channel >= 0 ? channel : null;
}

function pushUnique(items: number[], value: number): void {
  if (!items.includes(value)) items.push(value);
}

function channelHasFiniteData(ds: Dataset, channel: number): boolean {
  // A lazy Origin book carries only a sampled preview until the apply/open
  // preflight resolves it. Absence from that preview is unknown, not proof
  // that the full saved column is empty.
  if (ds.pending) return true;
  // No column copy: this runs for every curve on every Library row render.
  return channel < 0 ? ds.data.time.some(Number.isFinite) : ds.data.values.some((row) => Number.isFinite(row[channel]));
}

function curveProblem(ds: Dataset, curve: OriginCurve): UnresolvedOriginBinding["reason"] | null {
  const x = channelOf(ds, curve.x);
  const y = channelOf(ds, curve.y);
  if (x === null) return "x_column_not_decoded";
  if (y === null || y < 0) return "y_column_not_decoded";
  if (!channelHasFiniteData(ds, x)) return "x_column_has_no_numeric_data";
  if (!channelHasFiniteData(ds, y)) return "y_column_has_no_numeric_data";
  return null;
}

/** Preview one explicit saved-book -> imported-dataset recovery decision.
 * Every matching binding must be compatible; partial bulk mappings fail
 * closed because a single Apply button must mean the whole listed scope. */
export function previewOriginSourceMapping(
  entries: OriginFigureEntry[],
  ds: Dataset,
  book: string,
): OriginSourceMappingPreview {
  const entryIds: string[] = [];
  const incompatible: UnresolvedOriginBinding[] = [];
  let bindingCount = 0;
  for (const entry of entries) {
    if (!entry.siblingIds.includes(ds.id)) continue;
    const curves = (entry.figure.curves ?? []).filter((curve) => curve.book === book);
    if (curves.length === 0) continue;
    entryIds.push(entry.id);
    for (const curve of curves) {
      bindingCount += 1;
      const hasOriginBook = String((ds.data.metadata ?? {}).origin_book ?? "").length > 0;
      const reason = hasOriginBook ? curveProblem(ds, curve) : "book_not_imported";
      if (reason) incompatible.push({ ...curveRef(curve), reason });
    }
  }
  return {
    book,
    datasetId: ds.id,
    entryIds,
    bindingCount,
    incompatible,
    canApply: entryIds.length > 0 && incompatible.length === 0,
  };
}

function mappedDataset(
  entry: OriginFigureEntry,
  book: string,
  candidates: Dataset[],
): Dataset | undefined {
  const override = entry.sourceOverrides?.[book];
  if (override) return candidates.find((candidate) => candidate.id === override
    && String((candidate.data.metadata ?? {}).origin_book ?? "").length > 0);
  return book.length > 0 ? candidates.find(
    (candidate) => String((candidate.data.metadata ?? {}).origin_book ?? "") === book,
  ) : undefined;
}

/** Clone only the decoded curve-book references needed by apply/render code.
 * The persisted Origin figure remains byte-for-byte faithful; this projection
 * makes a confirmed source override consumable by existing selection/overlay
 * algorithms without teaching them to guess aliases. */
export function originFigureWithSourceMappings(
  entry: OriginFigureEntry,
  datasets: Dataset[],
): OriginFigureEntry {
  if (!entry.sourceOverrides || !entry.figure.curves?.length) return entry;
  const mappedBooks = new Map<string, Dataset>();
  for (const [book, datasetId] of Object.entries(entry.sourceOverrides)) {
    const ds = datasets.find((candidate) => candidate.id === datasetId
      && entry.siblingIds.includes(candidate.id)
      && String((candidate.data.metadata ?? {}).origin_book ?? "").length > 0);
    const curves = entry.figure.curves.filter((curve) => curve.book === book);
    // A saved mapping can outlive a worksheet schema edit. Projection is
    // deliberately all-or-nothing per saved book so apply never silently
    // drops the now-incompatible curves or redirects them to another source.
    if (ds && curves.length > 0 && curves.every((curve) => curveProblem(ds, curve) === null)) {
      mappedBooks.set(book, ds);
    }
  }
  const curves = entry.figure.curves.map((curve) => {
    const ds = mappedBooks.get(curve.book);
    if (!ds) return curve;
    const mappedBook = String((ds.data.metadata ?? {}).origin_book ?? "");
    return mappedBook ? { ...curve, book: mappedBook } : curve;
  });
  const mappedTarget = entry.datasetId ?? Object.keys(entry.sourceOverrides)
    .map((book) => mappedBooks.get(book)?.id)
    .find((id): id is string => id != null) ?? null;
  return { ...entry, datasetId: mappedTarget, figure: { ...entry.figure, curves } };
}

/** Resolve raw curve letters against a workbook the user explicitly chose.
 * Unlike automatic resolution this intentionally ignores the curve's book
 * name; the picker choice is the authority. Still never invents a column. */
export function resolveOriginSourceManually(
  entry: OriginFigureEntry,
  figures: OriginFigureEntry[],
  ds: Dataset,
  options: { requireFinite?: boolean } = {},
): OriginSourceBinding | null {
  const source: OriginSourceBinding = {
    datasetId: ds.id,
    book: String((ds.data.metadata ?? {}).origin_book ?? ds.name),
    xColumns: [], yColumns: [], errorColumns: [], columns: [],
  };
  for (const member of figureLayerFamily(entry, figures)) {
    for (const curve of member.figure.curves ?? []) {
      const x = channelOf(ds, curve.x);
      const y = channelOf(ds, curve.y);
      if (x === null || y === null || y < 0) continue;
      if (options.requireFinite && (!channelHasFiniteData(ds, x) || !channelHasFiniteData(ds, y))) continue;
      pushUnique(source.xColumns, x);
      pushUnique(source.yColumns, y);
      pushUnique(source.columns, x);
      pushUnique(source.columns, y);
      const err = originErrKeys(ds.data)[y];
      if (err !== undefined) {
        pushUnique(source.errorColumns, err);
        pushUnique(source.columns, err);
      }
    }
  }
  return source.yColumns.length ? source : null;
}

/** Resolve every decoded curve in a graph page, preserving layer/curve order. */
export function resolveOriginFigureSources(
  entry: OriginFigureEntry,
  figures: OriginFigureEntry[],
  datasets: Dataset[],
): OriginSourceResolution {
  const siblings = new Set(entry.siblingIds);
  const candidates = datasets.filter((ds) => siblings.has(ds.id));
  const sources: OriginSourceBinding[] = [];
  const unresolved: UnresolvedOriginBinding[] = [];
  const family = figureLayerFamily(entry, figures);

  for (const member of family.length ? family : [entry]) {
    for (const curve of member.figure.curves ?? []) {
      const ds = mappedDataset(member, curve.book, candidates);
      if (!ds) {
        unresolved.push({ ...curveRef(curve), reason: "book_not_imported" });
        continue;
      }
      const problem = curveProblem(ds, curve);
      if (problem) {
        unresolved.push({ ...curveRef(curve), reason: problem });
        continue;
      }
      const x = channelOf(ds, curve.x)!;
      const y = channelOf(ds, curve.y)!;
      let source = sources.find((item) => item.datasetId === ds.id);
      if (!source) {
        source = { datasetId: ds.id, book: curve.book, xColumns: [], yColumns: [], errorColumns: [], columns: [] };
        sources.push(source);
      }
      pushUnique(source.xColumns, x);
      pushUnique(source.yColumns, y);
      pushUnique(source.columns, x);
      pushUnique(source.columns, y);
      const err = originErrKeys(ds.data)[y];
      if (err !== undefined) {
        pushUnique(source.errorColumns, err);
        pushUnique(source.columns, err);
      }
    }
  }
  return { sources, unresolved };
}

function curveRef(curve: OriginCurve): Pick<UnresolvedOriginBinding, "book" | "x" | "y"> {
  return { book: curve.book, x: curve.x, y: curve.y };
}
