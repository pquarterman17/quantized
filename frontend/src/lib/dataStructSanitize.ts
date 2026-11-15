// The .dwk loader's structural repair of a DataStruct's categorical tables.
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// lib/categorical.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; lib/categorical.ts does not re-export it.

import { isValidLevelList } from "./categorical";
import type { DataStruct } from "./types";

/** Structural repair of a possibly-corrupted DataStruct's `cat_levels` (P1.4
 *  review P2-3/P3-1): drop any entry whose level list isn't a non-empty
 *  array of strings (a hand-edited/corrupted .dwk, e.g. `{0: "AB"}` --
 *  `isValidLevelList` (lib/categorical.ts) is what protects the accessors, but a
 *  parsed DataStruct is sanitized once up front too, so it never even
 *  CARRIES a malformed entry into the store). Called by `lib/workspace.ts`'s
 *  `parseWorkspace` on every DataStruct that already passed its own
 *  structural check (time/values/labels/units/metadata) -- this only
 *  repairs `cat_levels`, never rejects the dataset. Returns the SAME object
 *  when there's nothing to repair (the common, non-categorical case) or a
 *  fresh one otherwise -- never mutates the input. */
export function sanitizeDataStruct(data: DataStruct): DataStruct {
  return sanitizeLevelOrder(sanitizeCatLevels(data));
}

/** Structural repair of a possibly-corrupted `level_order` (Group O-2), the
 *  same contract `sanitizeCatLevels` has for the level table: drop any entry
 *  that isn't a non-empty array of finite numbers. `levelOrderFor` (categorical)
 *  already degrades safely on read — this only keeps a parsed DataStruct from
 *  CARRYING junk into the store, so a later `.dwk` save doesn't write it back
 *  out. Returns the SAME object when there is nothing to repair. */
function sanitizeLevelOrder(data: DataStruct): DataStruct {
  const raw = data.level_order;
  if (raw === undefined) return data;
  const out: Record<number, number[]> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [key, codes] of Object.entries(raw)) {
      const idx = Number(key);
      // `-1` is a REAL channel here, not junk: it is the x/time column, which
      // `categoryLevels` reads (the interactive categorical x-axis passes
      // `xKey`, and Split accepts "x or a value channel"). An earlier version
      // rejected `idx < 0`, so an x-axis order was honoured in-session, written
      // to the file, and silently deleted on reopen — the accessor and the
      // sanitizer disagreeing about which channels exist.
      if (!Number.isInteger(idx) || idx < -1 || !Array.isArray(codes)) continue;
      const clean = codes.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (clean.length) out[idx] = clean;
    }
  }
  const { level_order: _drop, ...rest } = data;
  return Object.keys(out).length ? { ...rest, level_order: out } : (rest as DataStruct);
}

function sanitizeCatLevels(data: DataStruct): DataStruct {
  const raw = data.cat_levels;
  if (raw === undefined) return data;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    const { cat_levels: _drop, ...rest } = data;
    return rest as DataStruct;
  }
  const out: Record<number, string[]> = {};
  for (const [key, list] of Object.entries(raw)) {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && isValidLevelList(list)) out[idx] = list;
  }
  const { cat_levels: _drop, ...rest } = data;
  return Object.keys(out).length ? { ...rest, cat_levels: out } : (rest as DataStruct);
}
