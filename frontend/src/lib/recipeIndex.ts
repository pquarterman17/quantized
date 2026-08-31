// P3.5 slice 1 — cross-cutting recipe metadata, stored BESIDE the recipes.
//
// Favorites, tags and recent-use are properties of how a person USES a recipe,
// not of what the recipe is. Writing them into the six underlying formats
// would mean six schema migrations on real user data, would put a mutable
// field into records that are exported and shared (your tags riding along in
// a colleague's copy), and would be impossible for the four name-keyed systems
// whose records are replaced wholesale on every save. So this is a sidecar:
// one small map from `refKey` to metadata, and the recipe formats stay exactly
// as they are.
//
// ── THE ORPHANING HAZARD ─────────────────────────────────────────────────
// For analysis/peak/graph/fitModel the id IS the name (see recipeLibrary.ts).
// Renaming one is a delete plus a create, so a sidecar keyed by name loses its
// entry the moment a user renames — favorites and tags silently vanishing is
// exactly the kind of small betrayal that makes people stop trusting a
// feature. `moveEntry` exists so a rename can carry the metadata across, and
// callers that rename a name-keyed recipe MUST call it.
//
// ── WHY PRUNING IS GUARDED ───────────────────────────────────────────────
// An index that only ever grows is a leak, so `pruneEntries` drops metadata
// for recipes that no longer exist. But the obvious implementation is
// dangerous: every source reader here returns [] both when a system genuinely
// holds nothing AND when localStorage threw (private mode, quota, a corrupt
// value). Pruning against a list built from a FAILED read would delete every
// favorite the user has. So pruning takes an explicit completeness flag and
// no-ops unless the caller can vouch that every source was read successfully.

import { type RecipeRef, refKey } from "./recipeLibrary";

const KEY = "qz.recipeIndex";

/** Bound on stored entries. Metadata is tiny, but this shares a localStorage
 *  quota with autosave and the calculator history, and an unbounded map is
 *  how one feature starves another (the lesson `store/calcHistory.ts` already
 *  learned the hard way). Favorites are preserved ahead of plain recents when
 *  trimming, because a favorite is an explicit choice and a recent is a
 *  side effect. */
const MAX_ENTRIES = 500;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 40;

export interface RecipeMeta {
  favorite: boolean;
  tags: string[];
  lastUsedAt?: string;
  useCount: number;
}

const EMPTY: RecipeMeta = { favorite: false, tags: [], useCount: 0 };

/** Metadata for a ref that has none. Frozen and shared — callers must not
 *  mutate it, and every write path below builds a fresh object. */
export function emptyMeta(): RecipeMeta {
  return { ...EMPTY, tags: [] };
}

type IndexMap = Record<string, RecipeMeta>;

function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, MAX_TAG_LEN);
  return t === "" ? null : t;
}

/** Drop-malformed-never-throw, the same convention as `sanitizeRecipes` and
 *  `sanitizeQuickPlotTemplates`: one bad entry must not cost the user the
 *  whole index. */
function sanitize(v: unknown): IndexMap {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: IndexMap = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Partial<RecipeMeta>;
    const tags: string[] = [];
    if (Array.isArray(m.tags)) {
      for (const t of m.tags) {
        const norm = normalizeTag(t);
        if (norm !== null && !tags.includes(norm)) tags.push(norm);
        if (tags.length >= MAX_TAGS) break;
      }
    }
    const useCount = typeof m.useCount === "number" && Number.isFinite(m.useCount) ? Math.max(0, Math.floor(m.useCount)) : 0;
    const entry: RecipeMeta = { favorite: m.favorite === true, tags, useCount };
    if (typeof m.lastUsedAt === "string") entry.lastUsedAt = m.lastUsedAt;
    // An entry carrying nothing is not worth a slot; this also collapses the
    // rows a previous version wrote before some field was added.
    if (!entry.favorite && tags.length === 0 && entry.useCount === 0 && entry.lastUsedAt === undefined) continue;
    out[key] = entry;
  }
  return out;
}

export function loadIndex(): IndexMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? {} : sanitize(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Trim to `MAX_ENTRIES`, favorites first, then most-recently-used. */
function trim(map: IndexMap): IndexMap {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return map;
  keys.sort((a, b) => {
    const A = map[a];
    const B = map[b];
    if (A.favorite !== B.favorite) return A.favorite ? -1 : 1;
    return (B.lastUsedAt ?? "").localeCompare(A.lastUsedAt ?? "");
  });
  const out: IndexMap = {};
  for (const k of keys.slice(0, MAX_ENTRIES)) out[k] = map[k];
  return out;
}

function save(map: IndexMap): void {
  const trimmed = trim(map);
  // Progressive shedding rather than losing the lot, matching
  // `store/calcHistory.ts`: under quota pressure keep the explicit choices
  // (favorites and tags) and drop the derived recency first.
  const favoritesOnly: IndexMap = {};
  for (const [k, m] of Object.entries(trimmed)) {
    if (m.favorite || m.tags.length > 0) favoritesOnly[k] = { ...m, useCount: 0, lastUsedAt: undefined };
  }
  for (const attempt of [trimmed, favoritesOnly, {}]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(attempt));
      return;
    } catch {
      /* try a smaller payload */
    }
  }
}

function update(ref: RecipeRef, fn: (m: RecipeMeta) => RecipeMeta): RecipeMeta {
  const map = loadIndex();
  const key = refKey(ref);
  const next = fn(map[key] ?? emptyMeta());
  if (!next.favorite && next.tags.length === 0 && next.useCount === 0 && next.lastUsedAt === undefined) {
    delete map[key];
  } else {
    map[key] = next;
  }
  save(map);
  return next;
}

export function metaFor(ref: RecipeRef, map?: IndexMap): RecipeMeta {
  return (map ?? loadIndex())[refKey(ref)] ?? emptyMeta();
}

export function setFavorite(ref: RecipeRef, favorite: boolean): RecipeMeta {
  return update(ref, (m) => ({ ...m, favorite }));
}

export function setTags(ref: RecipeRef, tags: readonly string[]): RecipeMeta {
  const clean: string[] = [];
  for (const t of tags) {
    const norm = normalizeTag(t);
    if (norm !== null && !clean.includes(norm)) clean.push(norm);
    if (clean.length >= MAX_TAGS) break;
  }
  return update(ref, (m) => ({ ...m, tags: clean }));
}

/** Record an apply. `now` is injected so callers (and tests) control the
 *  clock rather than this module reaching for one. */
export function recordUse(ref: RecipeRef, now: string = new Date().toISOString()): RecipeMeta {
  return update(ref, (m) => ({ ...m, lastUsedAt: now, useCount: m.useCount + 1 }));
}

/** Forget one recipe's metadata outright. For a DELETE, where the recipe is
 *  provably gone and waiting for `pruneEntries` would be wrong: pruning is
 *  guarded on every source having been read completely, so a deletion made
 *  while some other system is unreadable would otherwise keep its favorite
 *  and tags indefinitely — and worse, hand them to the next recipe saved
 *  under that name (the name-keyed kinds key on it). */
export function dropEntry(ref: RecipeRef): void {
  const map = loadIndex();
  const key = refKey(ref);
  if (!(key in map)) return;
  delete map[key];
  save(map);
}

/** Carry metadata across a rename. Required for the name-keyed kinds, where
 *  the ref itself changes; harmless for the rest. Merges into any existing
 *  entry at the destination rather than clobbering it, since a rename onto an
 *  occupied name is an upsert in those systems too. */
export function moveEntry(from: RecipeRef, to: RecipeRef): void {
  const map = loadIndex();
  const fromKey = refKey(from);
  const toKey = refKey(to);
  if (fromKey === toKey) return;
  const moving = map[fromKey];
  if (!moving) return;
  const existing = map[toKey];
  map[toKey] = existing
    ? {
        favorite: existing.favorite || moving.favorite,
        tags: [...new Set([...existing.tags, ...moving.tags])].slice(0, MAX_TAGS),
        useCount: existing.useCount + moving.useCount,
        lastUsedAt: [existing.lastUsedAt, moving.lastUsedAt].filter(Boolean).sort().pop(),
      }
    : moving;
  delete map[fromKey];
  save(map);
}

/** Drop metadata for recipes that no longer exist.
 *
 *  `complete` is not a courtesy flag. Every source reader returns an empty
 *  list both for "this system is empty" and for "the read failed", so pruning
 *  against a list built from a failed read would delete every favorite the
 *  user has. Callers pass false whenever ANY source could not be read, and
 *  this then does nothing at all — an index that is briefly too big is a
 *  non-event next to silently wiping someone's favorites. */
export function pruneEntries(liveKeys: ReadonlySet<string>, complete: boolean): number {
  if (!complete) return 0;
  const map = loadIndex();
  let dropped = 0;
  for (const key of Object.keys(map)) {
    if (!liveKeys.has(key)) {
      delete map[key];
      dropped += 1;
    }
  }
  if (dropped > 0) save(map);
  return dropped;
}
