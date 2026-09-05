// Integration-level tests for `postJSON`'s dataset-handle-cache dispatch
// (RSM_CUTS_PLAN item 18) against a mocked global `fetch` -- proves the
// wiring between `http.ts` and `./datasetCache` end to end, one layer above
// `datasetCache.test.ts`'s direct unit tests of the pure retry logic.

import { afterEach, describe, expect, it, vi } from "vitest";

import { postJSON } from "./http";

const fakeResponse = (body: unknown, opts: { ok?: boolean; status?: number; handle?: string } = {}): Response =>
  ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.ok === false ? "Error" : "OK",
    json: () => Promise.resolve(body),
    headers: {
      get: (name: string) => (name === "X-Dataset-Handle" ? (opts.handle ?? null) : null),
    },
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postJSON dataset-cache dispatch", () => {
  it("sends the full dataset on the first /api/rsm/box call, then only the handle on a repeat", async () => {
    const dataset = { time: [1, 2, 3], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {} };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ result: "first" }, { handle: "abc123" }))
      .mockResolvedValueOnce(fakeResponse({ result: "second" }, { handle: "abc123" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await postJSON<{ result: string }>("/api/rsm/box", { dataset, x_min: 0 });
    expect(first).toEqual({ result: "first" });
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstBody.dataset).toEqual(dataset);
    expect(firstBody.dataset_handle).toBeUndefined();

    const second = await postJSON<{ result: string }>("/api/rsm/box", { dataset, x_min: 1 });
    expect(second).toEqual({ result: "second" });
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.dataset).toBeUndefined();
    expect(secondBody.dataset_handle).toBe("abc123");
  });

  it("intercepts /api/plot/series (P3.5): sends the full dataset once, then only the handle", async () => {
    const dataset = { time: [1], values: [[1]], labels: ["a"], units: [""], metadata: {} };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ result: "first" }, { handle: "abc123" }))
      .mockResolvedValueOnce(fakeResponse({ result: "second" }, { handle: "abc123" }));
    vi.stubGlobal("fetch", fetchMock);

    await postJSON("/api/plot/series", { dataset, decimate_width: 800 });
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstBody.dataset).toEqual(dataset);
    expect(firstBody.dataset_handle).toBeUndefined();

    // A windowed re-fetch (the committed-zoom follow-up) reuses the SAME
    // `dataset` object -- the handle it got back on the first call is sent
    // in its place, not the full payload again.
    await postJSON("/api/plot/series", { dataset, decimate_width: 800, x_min: 1, x_max: 2 });
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.dataset).toBeUndefined();
    expect(secondBody.dataset_handle).toBe("abc123");
    expect(secondBody.x_min).toBe(1); // other fields still forwarded
  });

  it("transparently recovers from a 409 unknown-handle response", async () => {
    const dataset = { time: [1], values: [[1]], labels: ["a"], units: [""], metadata: {} };
    const fetchMock = vi
      .fn()
      // first call: caches "h1"
      .mockResolvedValueOnce(fakeResponse({ n: 1 }, { handle: "h1" }))
      // second call: server has evicted h1 -> 409
      .mockResolvedValueOnce(fakeResponse({ detail: "unknown_dataset_handle" }, { ok: false, status: 409 }))
      // retry with the full dataset succeeds
      .mockResolvedValueOnce(fakeResponse({ n: 2 }, { handle: "h2" }));
    vi.stubGlobal("fetch", fetchMock);

    await postJSON("/api/rsm/box", { dataset });
    const result = await postJSON<{ n: number }>("/api/rsm/box", { dataset });

    expect(result).toEqual({ n: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(retryBody.dataset).toEqual(dataset); // the transparent resend carried the full payload
  });

  it("still throws for a genuine (non-cache) error on a cache-eligible path", async () => {
    const dataset = { time: [1], values: [[1]], labels: ["a"], units: [""], metadata: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse({ detail: "empty selection" }, { ok: false, status: 422 }),
      ),
    );
    await expect(postJSON("/api/rsm/box", { dataset })).rejects.toThrow("empty selection");
  });
});
