// Deterministic JSON for persisted scientific definitions. JavaScript keeps
// object insertion order, so plain JSON.stringify can make two equivalent
// parameter maps serialize differently (and, worse, compare as different
// recipes). Arrays remain ordered because their order is semantic; object
// keys are sorted recursively.

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    // Match JSON.stringify's object semantics: undefined/function/symbol
    // properties are omitted. Array holes and undefined array members remain
    // null through JSON.stringify after the map above, also matching native.
    if (item !== undefined && typeof item !== "function" && typeof item !== "symbol") {
      out[key] = canonicalValue(item);
    }
  }
  return out;
}

/** JSON.stringify with recursive object-key ordering. */
export function canonicalJson(value: unknown, space?: number): string {
  return JSON.stringify(canonicalValue(value), null, space);
}
