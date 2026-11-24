// Fit Model's saved recipe (GAP_AUDIT_9 G1): the type, the order-free term
// key and the parser of `parameters.recipe`. Its own tiny module so the result
// registries (lib/snapshotResultKey, lib/resultBook, the result panel) can
// recognise a Fit Model result without importing the workshop's libraries.

import type { AnalysisResult } from "./analysisResult";
import { textColumnEntries } from "./originTextColumnCells";
import type { Dataset } from "./types";

export const FIT_MODEL_PRODUCER = "fit-model";

export interface FitModelRecipe {
  responseCol: number;
  /** Column keys per term (-1 = X); a repeated key is a power. */
  terms: number[][];
  /** Column key -> kind, for every column a term uses. */
  kinds: Record<string, "continuous" | "nominal">;
  center: boolean;
  /** Digest of the text (sidecar) columns the model uses (lib/fitModelText); absent without any. */
  textDigest?: string;
}

export const termKey = (term: readonly number[]): string => [...term].sort((a, b) => a - b).join(",");

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The recipe a saved Fit Model result reruns from, or null when it does not
 *  parse (or names a column `source` no longer has). */
export function fitModelRecipe(result: AnalysisResult, source?: Dataset): FitModelRecipe | null {
  if (result.producer.id !== FIT_MODEL_PRODUCER) return null;
  const raw = record(record(result.parameters)?.recipe);
  if (!raw) return null;
  const { responseCol, terms, kinds, center, textDigest } = raw;
  // Keys <= -2 are text (sidecar) columns (lib/fitModelText): the k-th one is -2 - k.
  const textCount = source ? textColumnEntries(source.data).length : Infinity;
  const isCol = (v: unknown): v is number => Number.isInteger(v) && (
    (v as number) >= -1 ? !source || (v as number) < source.data.labels.length : -2 - (v as number) < textCount);
  if (!isCol(responseCol) || !Array.isArray(terms) || terms.length === 0 || typeof center !== "boolean") return null;
  if (!terms.every((t) => Array.isArray(t) && t.length > 0 && t.every(isCol))) return null;
  const kindMap = record(kinds);
  if (!kindMap) return null;
  const out: Record<string, "continuous" | "nominal"> = {};
  for (const t of terms as number[][]) for (const c of t) {
    const k = kindMap[String(c)];
    if (k !== "continuous" && k !== "nominal") return null;
    out[String(c)] = k;
  }
  return {
    responseCol, terms: (terms as number[][]).map((t) => [...t]), kinds: out, center,
    ...(typeof textDigest === "string" ? { textDigest } : {}),
  };
}
