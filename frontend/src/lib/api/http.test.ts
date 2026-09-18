// Integration-level tests for `postJSON`'s dataset-handle-cache dispatch
// (RSM_CUTS_PLAN item 18) against a mocked global `fetch` -- proves the
// wiring between `http.ts` and `./datasetCache` end to end, one layer above
// `datasetCache.test.ts`'s direct unit tests of the pure retry logic.

import { afterEach, describe, expect, it, vi } from "vitest";

import { postBlob, postDownload, postJSON } from "./http";
import { saveBlob } from "../download";

vi.mock("../download", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  saveBlob: vi.fn(),
}));

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

// PRIMARY_SOFTWARE_AUDIT_PLAN P3.4 (safe cancel for long export operations):
// the abort-race guard. exportActive.ts/exportPageCommand.ts abort their
// AbortController on Cancel, but a real `fetch` can only reject a request
// that hasn't finished yet — once the response (and its body) has already
// landed, aborting the controller does nothing on its own. postBlob/
// postDownload therefore re-check the SAME signal themselves, synchronously,
// in the same turn as the write (see `throwIfAborted`'s doc in http.ts) —
// these tests exercise exactly that gap by resolving the blob AFTER calling
// `controller.abort()`, i.e. the signal is "too late" for fetch's own wiring
// to have caught it.
const fakeBlobResponse = (blob: Blob, opts: { ok?: boolean } = {}): Response =>
  ({
    ok: opts.ok ?? true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({}),
    blob: () => Promise.resolve(blob),
    headers: { get: () => null },
  }) as unknown as Response;

describe("postDownload/postBlob — export-cancel abort-race guard", () => {
  it("postDownload never calls saveBlob once the signal is aborted, even though fetch already resolved", async () => {
    const controller = new AbortController();
    const blob = new Blob(["x"], { type: "application/pdf" });
    // The response is already sitting there — `fetch` resolved BEFORE the
    // click. `.abort()` below is exactly what a Cancel click does; nothing
    // about the (already-settled) fetch call can observe it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeBlobResponse(blob)));

    const p = postDownload("/api/export/figure", { fmt: "pdf" }, "figure.pdf", controller.signal);
    controller.abort();

    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("postDownload saves normally when the signal was never aborted", async () => {
    const controller = new AbortController();
    const blob = new Blob(["x"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeBlobResponse(blob)));

    await postDownload("/api/export/figure", { fmt: "pdf" }, "figure.pdf", controller.signal);
    expect(saveBlob).toHaveBeenCalledTimes(1);
  });

  it("postDownload with no signal at all still saves (every existing caller, unaffected)", async () => {
    const blob = new Blob(["x"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeBlobResponse(blob)));
    await postDownload("/api/export/figure", { fmt: "pdf" }, "figure.pdf");
    expect(saveBlob).toHaveBeenCalledTimes(1);
  });

  it("postBlob rejects instead of resolving a blob once the signal is aborted post-response (Copy figure's race)", async () => {
    const controller = new AbortController();
    const blob = new Blob(["x"], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeBlobResponse(blob)));

    const p = postBlob("/api/export/figure", { fmt: "png" }, controller.signal);
    controller.abort();

    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("postBlob resolves the blob normally when never aborted", async () => {
    const controller = new AbortController();
    const blob = new Blob(["x"], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeBlobResponse(blob)));
    await expect(postBlob("/api/export/figure", { fmt: "png" }, controller.signal)).resolves.toBe(blob);
  });
});
