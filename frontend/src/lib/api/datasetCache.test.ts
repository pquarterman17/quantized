// Unit tests for the client half of the dataset-handle cache (RSM_CUTS_PLAN
// item 18). Exercises `postJSONDatasetAware` directly against an injected
// `rawFetch` mock -- the pure logic under test (body-swap on repeat calls,
// transparent 409 recovery, passthrough for dataset-less bodies) doesn't
// need a real network layer. `http.test.ts` covers the same behaviour one
// layer up, through the real exported `postJSON`.

import { describe, expect, it, vi } from "vitest";

import { HttpError } from "./http";
import { isDatasetCachePath, postJSONDatasetAware } from "./datasetCache";
import type { RawFetchJSON } from "./datasetCache";

describe("isDatasetCachePath", () => {
  it("matches /api/plot/map, /api/plot/series, and every /api/rsm/* path", () => {
    expect(isDatasetCachePath("/api/plot/map")).toBe(true);
    expect(isDatasetCachePath("/api/plot/series")).toBe(true);
    expect(isDatasetCachePath("/api/rsm/box")).toBe(true);
    expect(isDatasetCachePath("/api/rsm/box-stats")).toBe(true);
    expect(isDatasetCachePath("/api/rsm/strain")).toBe(true); // prefix match; no dataset field anyway
  });

  it("does not match unrelated dataset-bearing routes", () => {
    expect(isDatasetCachePath("/api/corrections/apply")).toBe(false);
    expect(isDatasetCachePath("/api/export/figure")).toBe(false);
  });
});

describe("postJSONDatasetAware", () => {
  it("sends the full dataset on the first call for an object, remembers the handle", async () => {
    const dataset = { time: [1, 2, 3] };
    const rawFetch = vi.fn(async (_path, body) => {
      expect((body as Record<string, unknown>).dataset).toBe(dataset);
      // The key may be present with value `undefined` (JSON.stringify drops
      // it on the real wire) -- what matters is it never carries a value.
      expect((body as Record<string, unknown>).dataset_handle).toBeUndefined();
      return { value: { ok: true }, handle: "h1" };
    }) as unknown as RawFetchJSON;

    const result = await postJSONDatasetAware("/api/rsm/box", { dataset, x_min: 0 }, undefined, rawFetch);
    expect(result).toEqual({ ok: true });
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("swaps dataset for the remembered handle on a repeat call with the SAME object", async () => {
    const dataset = { time: [1, 2, 3] };
    const rawFetch = vi
      .fn()
      .mockResolvedValueOnce({ value: { ok: 1 }, handle: "h1" })
      .mockResolvedValueOnce({ value: { ok: 2 }, handle: "h1" }) as unknown as RawFetchJSON;

    await postJSONDatasetAware("/api/rsm/box", { dataset, x_min: 0 }, undefined, rawFetch);
    await postJSONDatasetAware("/api/rsm/box", { dataset, x_min: 1 }, undefined, rawFetch);

    const secondCallBody = (rawFetch as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(secondCallBody.dataset).toBeUndefined();
    expect(secondCallBody.dataset_handle).toBe("h1");
    expect(secondCallBody.x_min).toBe(1); // other fields still forwarded
  });

  it("does NOT reuse a handle across two DIFFERENT dataset objects", async () => {
    const rawFetch = vi
      .fn()
      .mockResolvedValueOnce({ value: { ok: 1 }, handle: "h1" })
      .mockResolvedValueOnce({ value: { ok: 2 }, handle: "h2" }) as unknown as RawFetchJSON;

    await postJSONDatasetAware("/api/rsm/box", { dataset: { a: 1 } }, undefined, rawFetch);
    await postJSONDatasetAware("/api/rsm/box", { dataset: { a: 1 } }, undefined, rawFetch); // different object, same shape

    const secondCallBody = (rawFetch as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(secondCallBody.dataset).toBeDefined(); // no remembered handle for THIS object -> full payload
  });

  it("does not store a handle when the server omits X-Dataset-Handle (a too-large dataset)", async () => {
    // routes/_datasetcache.py's cache_dataset returns None (no header sent)
    // when the posted dataset alone doesn't fit the cache budget -- a
    // missing header must not poison the WeakMap with a `null`/`undefined`
    // "handle" that would then ride the wire as `dataset_handle` on the
    // NEXT call for the same object, which the server could never resolve.
    const dataset = { time: [1, 2, 3] };
    const rawFetch = vi
      .fn()
      .mockResolvedValueOnce({ value: { ok: 1 }, handle: null })
      .mockResolvedValueOnce({ value: { ok: 2 }, handle: null }) as unknown as RawFetchJSON;

    await postJSONDatasetAware("/api/rsm/box", { dataset, x_min: 0 }, undefined, rawFetch);
    await postJSONDatasetAware("/api/rsm/box", { dataset, x_min: 1 }, undefined, rawFetch);

    const secondCallBody = (rawFetch as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    // Still the full dataset on the second call -- no handle was ever
    // remembered, so there is nothing to swap in.
    expect(secondCallBody.dataset).toBe(dataset);
    expect(secondCallBody.dataset_handle).toBeUndefined();
  });

  it("passes a body with no dataset field straight through, untouched", async () => {
    const rawFetch = vi.fn(async () => ({ value: { ok: true }, handle: null })) as unknown as RawFetchJSON;
    const body = { q_sub: [0.5, 4.0], q_film: [0.4, 3.8] };
    await postJSONDatasetAware("/api/rsm/strain", body, undefined, rawFetch);
    expect(rawFetch).toHaveBeenCalledWith("/api/rsm/strain", body, undefined);
  });

  it("recovers transparently from a 409 (unknown/evicted handle): resends once, updates the handle", async () => {
    const dataset = { time: [1, 2, 3] };
    const rawFetch = vi.fn();
    // First call ever: succeeds, caches handle "stale".
    rawFetch.mockResolvedValueOnce({ value: { first: true }, handle: "stale" });
    // Second call: server evicted "stale" server-side -> 409.
    rawFetch.mockRejectedValueOnce(new HttpError(409, "unknown_dataset_handle"));
    // Retry with the full dataset succeeds, server issues a fresh handle.
    rawFetch.mockResolvedValueOnce({ value: { recovered: true }, handle: "fresh" });

    await postJSONDatasetAware("/api/rsm/box", { dataset }, undefined, rawFetch as unknown as RawFetchJSON);
    const result = await postJSONDatasetAware(
      "/api/rsm/box",
      { dataset },
      undefined,
      rawFetch as unknown as RawFetchJSON,
    );

    expect(result).toEqual({ recovered: true });
    expect(rawFetch).toHaveBeenCalledTimes(3);
    const retryBody = rawFetch.mock.calls[2][1] as Record<string, unknown>;
    expect(retryBody.dataset).toBe(dataset); // full payload on the retry
    expect(retryBody.dataset_handle).toBeUndefined();

    // A THIRD call now uses the freshly-remembered handle, not "stale".
    rawFetch.mockResolvedValueOnce({ value: { third: true }, handle: "fresh" });
    await postJSONDatasetAware("/api/rsm/box", { dataset }, undefined, rawFetch as unknown as RawFetchJSON);
    const thirdBody = rawFetch.mock.calls[3][1] as Record<string, unknown>;
    expect(thirdBody.dataset_handle).toBe("fresh");
  });

  it("re-throws a non-409 error without retrying", async () => {
    const dataset = { time: [1, 2, 3] };
    const rawFetch = vi
      .fn()
      .mockResolvedValueOnce({ value: { ok: true }, handle: "h1" })
      .mockRejectedValueOnce(new HttpError(500, "server exploded")) as unknown as RawFetchJSON;

    await postJSONDatasetAware("/api/rsm/box", { dataset }, undefined, rawFetch);
    await expect(
      postJSONDatasetAware("/api/rsm/box", { dataset }, undefined, rawFetch),
    ).rejects.toThrow("server exploded");
    expect(rawFetch).toHaveBeenCalledTimes(2); // no retry attempted
  });

  it("re-throws a 409 when there was never a remembered handle to have gone stale", async () => {
    // Defensive case: should not happen in practice (a first-ever call always
    // sends the full dataset, which the server cannot 409 on), but a bare
    // 409 with nothing cached must not loop or swallow the error.
    const dataset = { time: [9] };
    const rawFetch = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(409, "unknown_dataset_handle")) as unknown as RawFetchJSON;
    await expect(
      postJSONDatasetAware("/api/rsm/box", { dataset }, undefined, rawFetch),
    ).rejects.toThrow("unknown_dataset_handle");
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("forwards the abort signal on both the initial call and the retry", async () => {
    const dataset = { time: [1] };
    const controller = new AbortController();
    const rawFetch = vi
      .fn()
      .mockResolvedValueOnce({ value: { ok: true }, handle: "h1" })
      .mockRejectedValueOnce(new HttpError(409, "unknown_dataset_handle"))
      .mockResolvedValueOnce({ value: { ok: true }, handle: "h2" }) as unknown as RawFetchJSON;

    await postJSONDatasetAware("/api/rsm/box", { dataset }, controller.signal, rawFetch);
    await postJSONDatasetAware("/api/rsm/box", { dataset }, controller.signal, rawFetch);

    for (const call of (rawFetch as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[2]).toBe(controller.signal);
    }
  });
});
