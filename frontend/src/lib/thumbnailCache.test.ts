import { afterEach, describe, expect, it } from "vitest";

import {
  clearThumbnailCache,
  entityRevision,
  getCachedThumbnail,
  registerThumbnailGenerator,
  setCachedThumbnail,
  THUMBNAIL_CACHE_MAX,
  thumbnailGeneratorFor,
  unregisterThumbnailGenerator,
  type ThumbnailResult,
} from "./thumbnailCache";

const thumb = (url: string): ThumbnailResult => ({ url, width: 160, height: 120 });

afterEach(() => {
  clearThumbnailCache();
  unregisterThumbnailGenerator("report");
});

describe("thumbnailCache — revision tagging (E-c1)", () => {
  it("the same store object keeps its revision across reads", () => {
    const entity = { id: "p1" };
    expect(entityRevision(entity)).toBe(entityRevision(entity));
  });

  it("a replaced store object (any mutation) gets a new revision", () => {
    expect(entityRevision({ id: "p1" })).not.toBe(entityRevision({ id: "p1" }));
  });
});

describe("thumbnailCache — bounded LRU", () => {
  it("serves a cached result only for the matching fingerprint, dropping stale entries", () => {
    setCachedThumbnail("page:p1", "1.2", thumb("a"));
    expect(getCachedThumbnail("page:p1", "1.2")?.url).toBe("a");
    expect(getCachedThumbnail("page:p1", "1.3")).toBeNull(); // stale — dropped
    expect(getCachedThumbnail("page:p1", "1.2")).toBeNull(); // and GONE, never re-served
  });

  it("evicts the least recently USED entry at capacity (get refreshes recency)", () => {
    for (let i = 0; i < THUMBNAIL_CACHE_MAX; i++) setCachedThumbnail(`k${i}`, "1", thumb(`u${i}`));
    expect(getCachedThumbnail("k0", "1")?.url).toBe("u0"); // refresh k0 — k1 is now oldest
    setCachedThumbnail("overflow", "1", thumb("new"));
    expect(getCachedThumbnail("k1", "1")).toBeNull();
    expect(getCachedThumbnail("k0", "1")?.url).toBe("u0");
    expect(getCachedThumbnail("overflow", "1")?.url).toBe("new");
  });

  it("clearThumbnailCache wipes everything (workspace reset)", () => {
    setCachedThumbnail("k", "1", thumb("u"));
    clearThumbnailCache();
    expect(getCachedThumbnail("k", "1")).toBeNull();
  });
});

describe("thumbnailCache — generator registry", () => {
  it("registers one generator per kind and throws on double registration", () => {
    const gen = async () => thumb("x");
    registerThumbnailGenerator("report", gen);
    expect(thumbnailGeneratorFor("report")).toBe(gen);
    expect(() => registerThumbnailGenerator("report", gen)).toThrow(/already registered/);
  });

  it("an unregistered kind is unsupported (null), never a fallback generator", () => {
    expect(thumbnailGeneratorFor("editable-figure")).toBeNull();
  });
});
