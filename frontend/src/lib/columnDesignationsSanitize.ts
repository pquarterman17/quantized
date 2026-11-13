// Load-time sanitizer for `Dataset.columnDesignations` (the worksheet's "Set
// As" map), split from lib/columnmeta.ts so it rides in the .dwk loader's
// chunk rather than the eager one (scripts/check-bundle-size.mjs).

import type { ColumnDesignations, OriginDesignation } from "./columnmeta";

// The same seven strings as columnmeta's ORIGIN_DESIGNATIONS (pinned equal by
// columnDesignations.test.ts); restated so this loader-side module takes no
// runtime import of the eager columnmeta chunk.
const KNOWN: readonly string[] = ["X", "Y", "Y-error", "X-error", "label", "disregard", "Z"];

/** Keep only integer channel keys inside `[0, width)` mapped to a known
 *  designation; `undefined` when nothing valid remains (the field is then
 *  omitted, never stored empty). */
export function sanitizeColumnDesignations(raw: unknown, width: number): ColumnDesignations | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: ColumnDesignations = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = Number(k);
    if (Number.isInteger(c) && c >= 0 && c < width && typeof v === "string" && KNOWN.includes(v)) {
      out[c] = v as OriginDesignation;
    }
  }
  return Object.keys(out).length ? out : undefined;
}
