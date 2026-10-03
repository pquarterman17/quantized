import type { DataStruct } from "./types";

/** Raw Origin text-column entries, in stable short-name order. This small
 * reader stays eager because plot encodings can bind categorical sidecars. */
export function textColumnEntries(ds: Pick<DataStruct, "metadata">): [string, unknown[]][] {
  const metadata = ds.metadata ?? {};
  const raw = metadata["text_columns"] ?? metadata["origin_text_columns"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
}

export function originTextColumnNames(ds: Pick<DataStruct, "metadata">): string[] {
  return textColumnEntries(ds).map(([shortName]) => shortName);
}

export function textColumnCells(ds: Pick<DataStruct, "metadata">, name: string): readonly unknown[] | null {
  return textColumnEntries(ds).find(([n]) => n === name)?.[1] ?? null;
}
