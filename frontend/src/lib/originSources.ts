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
  reason: "book_not_imported" | "x_column_not_decoded" | "y_column_not_decoded";
}

export interface OriginSourceResolution {
  sources: OriginSourceBinding[];
  unresolved: UnresolvedOriginBinding[];
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

/** Resolve raw curve letters against a workbook the user explicitly chose.
 * Unlike automatic resolution this intentionally ignores the curve's book
 * name; the picker choice is the authority. Still never invents a column. */
export function resolveOriginSourceManually(
  entry: OriginFigureEntry,
  figures: OriginFigureEntry[],
  ds: Dataset,
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
      const ds = candidates.find(
        (candidate) => String((candidate.data.metadata ?? {}).origin_book ?? "") === curve.book,
      );
      if (!ds) {
        unresolved.push({ ...curveRef(curve), reason: "book_not_imported" });
        continue;
      }
      const x = channelOf(ds, curve.x);
      const y = channelOf(ds, curve.y);
      if (x === null) {
        unresolved.push({ ...curveRef(curve), reason: "x_column_not_decoded" });
        continue;
      }
      if (y === null || y < 0) {
        unresolved.push({ ...curveRef(curve), reason: "y_column_not_decoded" });
        continue;
      }
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
