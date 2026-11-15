// The .dwk reader's validation of saved smart folders.
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// lib/smartfolders.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; lib/smartfolders.ts does not re-export it.

import type { SmartFolder } from "./smartfolders";

/** Validate persisted smart folders at the untrusted .dwk boundary — drops
 *  malformed entries rather than throwing (mirrors parseFolders). */
export function sanitizeSmartFolders(v: unknown): SmartFolder[] {
  if (!Array.isArray(v)) return [];
  const out: SmartFolder[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      o.name.trim() !== "" &&
      typeof o.query === "string"
    ) {
      out.push({ id: o.id, name: o.name, query: o.query });
    }
  }
  return out;
}
