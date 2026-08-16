// E-c1: canonical thumbnail cache + generation contract (pure — no React,
// no DOM ownership; the visible-only scheduling lives in
// components/Library/useThumbnail.ts).
//
// DESIGN
// - One generator per node kind, registered here (E-c2 supplies the real
//   plot/table/analysis renderers; E-c1 ships the contract plus one
//   reference generator to prove the pipe). A kind with no generator is
//   "unsupported" — callers keep their existing static placeholder.
// - REVISION-KEYED invalidation: the store replaces an entity object on
//   every mutation (zustand immutability), so object identity IS the
//   revision. `revisionOf` tags each distinct entity object with a
//   monotonic id via a WeakMap — cheap, exact, and GC-safe. A cached
//   thumbnail is valid only while its node's entity keeps the same tag;
//   any store update that touches the entity invalidates it implicitly.
// - BOUNDED LRU: tiles scroll through arbitrarily large Libraries (E-c3),
//   so the cache holds a fixed number of entries and evicts
//   least-recently-USED (get refreshes recency). Ownership is module-level
//   (one cache per app), with an explicit reset for workspace wipes/tests.

import type { LibraryNode, LibraryNodeKind } from "./libraryHierarchy";

export interface ThumbnailResult {
  /** Renderable image source (data: URL — SVG or canvas PNG). */
  url: string;
  /** Natural size in CSS px, so the consumer can reserve layout. */
  width: number;
  height: number;
}

/** Generation is async and MUST honor `signal`: the hook aborts when the
 *  tile leaves the viewport, unmounts, or the entity changes mid-flight.
 *  Generators reject (any error, including AbortError) → the hook reports
 *  "error" (or discards silently on abort); they never return partial
 *  results. */
export type ThumbnailGenerator = (node: LibraryNode, signal: AbortSignal) => Promise<ThumbnailResult>;

// ── revision tagging ─────────────────────────────────────────────────────

let nextRevision = 1;
const revisionTags = new WeakMap<object, number>();

/** The node's cache revision: a stable tag for the entity OBJECT. Replacing
 *  the entity in the store (any mutation) yields a new object and therefore
 *  a new revision; an untouched entity keeps its tag across re-renders and
 *  hierarchy rebuilds. */
export function revisionOf(node: LibraryNode): number {
  const entity = node.entity as object;
  let tag = revisionTags.get(entity);
  if (tag == null) {
    tag = nextRevision++;
    revisionTags.set(entity, tag);
  }
  return tag;
}

// ── bounded LRU keyed by node key + revision ─────────────────────────────

const MAX_ENTRIES = 300;

interface CacheEntry {
  revision: number;
  result: ThumbnailResult;
}

/** Insertion-ordered Map as LRU: delete+set moves a key to the tail; the
 *  head is always the least recently used. */
const cache = new Map<string, CacheEntry>();

export function getCachedThumbnail(key: string, revision: number): ThumbnailResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.revision !== revision) {
    cache.delete(key); // stale revision — drop, never serve
    return null;
  }
  cache.delete(key);
  cache.set(key, entry); // refresh recency
  return entry.result;
}

export function setCachedThumbnail(key: string, revision: number, result: ThumbnailResult): void {
  cache.delete(key);
  cache.set(key, { revision, result });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

/** Workspace wipe / tests. */
export function clearThumbnailCache(): void {
  cache.clear();
}

/** Exposed for the eviction test only. */
export const THUMBNAIL_CACHE_MAX = MAX_ENTRIES;

// ── generator registry ───────────────────────────────────────────────────

const generators = new Map<LibraryNodeKind, ThumbnailGenerator>();

/** Single registration per kind (the io/registry.py convention): a second
 *  registration for the same kind is a programming error, surfaced loudly
 *  rather than silently last-write-wins. Tests may replace via
 *  `unregisterThumbnailGenerator` first. */
export function registerThumbnailGenerator(kind: LibraryNodeKind, generator: ThumbnailGenerator): void {
  if (generators.has(kind)) throw new Error(`thumbnail generator already registered for "${kind}"`);
  generators.set(kind, generator);
}

export function unregisterThumbnailGenerator(kind: LibraryNodeKind): void {
  generators.delete(kind);
}

export function thumbnailGeneratorFor(kind: LibraryNodeKind): ThumbnailGenerator | null {
  return generators.get(kind) ?? null;
}
