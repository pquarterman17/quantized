// E-c1: canonical thumbnail cache + generation contract (pure — no React,
// no DOM ownership; the visible-only scheduling lives in
// components/Library/useThumbnail.ts).
//
// DESIGN
// - One generator per node kind, registered here (E-c2 supplies the real
//   plot/table/analysis renderers; E-c1 ships the contract plus one
//   reference generator to prove the pipe). A kind with no generator is
//   "unsupported" — callers keep their existing static placeholder.
// - FINGERPRINT-KEYED invalidation: the store replaces objects on every
//   mutation (zustand immutability), so object identity is the revision
//   primitive (`entityRevision`, a WeakMap tag — cheap, exact, GC-safe).
//   A cache entry's fingerprint joins the tags of the entity AND every
//   preview-relevant dependency (referenced figures, live source
//   datasets — Sol review, PR #149), so touching ANY of them invalidates
//   implicitly. `lib/thumbnailRequest.ts` owns dependency resolution.
// - BOUNDED LRU: tiles scroll through arbitrarily large Libraries (E-c3),
//   so the cache holds a fixed number of entries and evicts
//   least-recently-USED (get refreshes recency). Ownership is module-level
//   (one cache per app), with an explicit reset for workspace wipes/tests.

import type { FigureDocument } from "./figureDocument";
import type { LibraryNode, LibraryNodeKind } from "./libraryHierarchy";
import type { Dataset } from "./types";

export interface ThumbnailResult {
  /** Renderable image source (data: URL — SVG or canvas PNG). */
  url: string;
  /** Natural size in CSS px, so the consumer can reserve layout. */
  width: number;
  height: number;
}

/** The resolved unit of generation (Sol review, PR #149): the node PLUS
 *  every preview-relevant dependency object (referenced figures, live
 *  source datasets), and the fingerprint composed from ALL of their
 *  revisions. The generator renders from `node`/`deps` — the exact
 *  objects the fingerprint was formed from — so key and render can never
 *  disagree. Assembled by `lib/thumbnailRequest.resolveThumbnailRequest`. */
export interface ThumbnailRequest {
  node: LibraryNode;
  /** Ordered resolved dependency entities; null marks a missing reference
   *  (a panel whose figure is gone), which the fingerprint encodes as a
   *  stable sentinel. This is the FINGERPRINT array — generators should
   *  read the TYPED slices below instead of shape-sniffing this one (the
   *  `"pending" in dep` bug class, PR #150 review). */
  deps: readonly (object | null)[];
  /** Page nodes: one entry per figure-referencing panel, in panel order
   *  (null = missing figure). Empty for every other kind. */
  figureDeps: readonly (FigureDocument | null)[];
  /** The node's live source datasets in `source.datasetIds` order
   *  (null = not in the snapshot). */
  datasetDeps: readonly (Dataset | null)[];
  fingerprint: string;
}

/** Generation is async and MUST honor `signal`: the hook aborts on unmount
 *  and whenever the request fingerprint changes mid-flight (entity OR any
 *  dependency replaced). Generators reject (any error, including
 *  AbortError) → the hook reports "error" (or discards silently on abort);
 *  they never return partial results. */
export type ThumbnailGenerator = (request: ThumbnailRequest, signal: AbortSignal) => Promise<ThumbnailResult>;

// ── revision tagging ─────────────────────────────────────────────────────

let nextRevision = 1;
const revisionTags = new WeakMap<object, number>();

/** A stable tag for one store OBJECT. The store replaces objects on every
 *  mutation (zustand immutability), so a replaced entity/dependency gets a
 *  new tag while an untouched one keeps its tag across re-renders and
 *  hierarchy rebuilds. The fingerprint of a request is these tags joined —
 *  see lib/thumbnailRequest.ts. */
export function entityRevision(entity: object): number {
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
  fingerprint: string;
  result: ThumbnailResult;
}

/** Insertion-ordered Map as LRU: delete+set moves a key to the tail; the
 *  head is always the least recently used. */
const cache = new Map<string, CacheEntry>();

export function getCachedThumbnail(key: string, fingerprint: string): ThumbnailResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.fingerprint !== fingerprint) {
    cache.delete(key); // stale fingerprint — drop, never serve
    return null;
  }
  cache.delete(key);
  cache.set(key, entry); // refresh recency
  return entry.result;
}

export function setCachedThumbnail(key: string, fingerprint: string, result: ThumbnailResult): void {
  cache.delete(key);
  cache.set(key, { fingerprint, result });
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
