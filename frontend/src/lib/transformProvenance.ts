import type { DataStruct, Dataset } from "./types";

/** A validated, display-safe view of `metadata.transform_recipe`.
 *
 * The metadata boundary is intentionally tolerant: older workspaces and
 * imported files may carry only the recipe name/revision, while current
 * Pipeline Studio outputs also record the input, bindings, step count and
 * timestamp. Consumers must never cast arbitrary metadata directly. */
export interface TransformProvenance {
  recipe: string;
  revision: number;
  input: { id: string; name: string } | null;
  bindings: { column: string; from: string | null }[];
  bindingsTruncated: boolean;
  steps: number | null;
  appliedAt: string | null;
}

export interface TransformRecipeRef {
  name: string;
  revision: number;
}

const MAX_BINDINGS = 512;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function sanitizeTransformProvenance(value: unknown): TransformProvenance | null {
  const raw = object(value);
  const recipe = typeof raw?.recipe === "string" ? raw.recipe.trim() : "";
  if (!recipe) return null;
  const revision = typeof raw?.revision === "number" && Number.isInteger(raw.revision) && raw.revision > 0
    ? raw.revision
    : 1;
  const rawInput = object(raw?.input);
  const input = rawInput && typeof rawInput.id === "string" && typeof rawInput.name === "string"
    ? { id: rawInput.id, name: rawInput.name }
    : null;
  const bindings = Array.isArray(raw?.bindings)
    ? raw.bindings.slice(0, MAX_BINDINGS).flatMap((value): TransformProvenance["bindings"] => {
        const binding = object(value);
        if (!binding || typeof binding.column !== "string") return [];
        return [{
          column: binding.column,
          from: typeof binding.from === "string" ? binding.from : null,
        }];
      })
    : [];
  const steps = typeof raw?.steps === "number" && Number.isInteger(raw.steps) && raw.steps >= 0
    ? raw.steps
    : null;
  const appliedAt = typeof raw?.appliedAt === "string" && raw.appliedAt.trim()
    ? raw.appliedAt
    : null;
  return {
    recipe,
    revision,
    input,
    bindings,
    // Preserve the disclosure when reading a previously sanitized/stored
    // snapshot. Otherwise a 512-entry capped record would look complete on
    // its second read because the discarded tail is no longer present.
    bindingsTruncated: raw?.bindingsTruncated === true ||
      (Array.isArray(raw?.bindings) && raw.bindings.length > MAX_BINDINGS),
    steps,
    appliedAt,
  };
}

export function transformProvenanceOfData(data: DataStruct | null | undefined): TransformProvenance | null {
  return sanitizeTransformProvenance(data?.metadata.transform_recipe);
}

export function transformProvenanceOfDataset(dataset: Dataset | null | undefined): TransformProvenance | null {
  return transformProvenanceOfData(dataset?.data);
}

export function transformRecipeRefOf(dataset: Dataset | null | undefined): TransformRecipeRef | null {
  const provenance = transformProvenanceOfDataset(dataset);
  return provenance ? { name: provenance.recipe, revision: provenance.revision } : null;
}

/** Compact user-facing identity; details remain available to the caller. */
export function transformRecipeLabel(provenance: TransformProvenance): string {
  return `${provenance.recipe} (revision ${provenance.revision})`;
}
