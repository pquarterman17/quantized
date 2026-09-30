// `plotSeries`'s transport gate: a dataset over COLUMNS_ROW_THRESHOLD rows
// asks for the binary column transport (through the lazily loaded
// `./plotColumns`); anything smaller, or a failed chunk load, takes the
// plain JSON path every pre-existing caller used.

import { afterEach, describe, expect, it, vi } from "vitest";

const fakeResponse = (body: unknown, handle: string | null = null): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    headers: { get: (name: string) => (name === "X-Dataset-Handle" ? handle : null) },
  }) as unknown as Response;

const dataset = (rows: number) => ({
  time: Array.from({ length: rows }, (_, i) => i),
  values: Array.from({ length: rows }, (_, i) => [i]),
  labels: ["a"],
  units: [""],
  metadata: {},
});

const payload = { data: [[1], [2]], series: [{ label: "a", unit: "", axis: 0 }], x: { label: "", unit: "", log: false }, y: { log: false } };

const accept = (fetchMock: ReturnType<typeof vi.fn>, call = 0): string | undefined =>
  ((fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>).Accept;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("./plotColumns");
  vi.resetModules();
});

describe("plotSeries transport gate", () => {
  it("stays on JSON at or under the threshold", async () => {
    const { COLUMNS_ROW_THRESHOLD, plotSeries } = await import("./plot");
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    expect(await plotSeries({ dataset: dataset(COLUMNS_ROW_THRESHOLD) })).toEqual(payload);
    expect(accept(fetchMock)).toBeUndefined();
  });

  it("asks for binary columns above the threshold, and still accepts a JSON answer", async () => {
    const { COLUMNS_ROW_THRESHOLD, plotSeries } = await import("./plot");
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    expect(await plotSeries({ dataset: dataset(COLUMNS_ROW_THRESHOLD + 1) })).toEqual(payload);
    expect(accept(fetchMock)).toContain("application/x-quantized-columns");
  });

  it("gates on the dataset's rows even when the response will be decimated", async () => {
    const { COLUMNS_ROW_THRESHOLD, plotSeries } = await import("./plot");
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    await plotSeries({ dataset: dataset(COLUMNS_ROW_THRESHOLD + 1), decimate_width: 800 });
    expect(accept(fetchMock)).toContain("application/x-quantized-columns");
  });

  it("falls back to JSON when the decoder chunk cannot be loaded", async () => {
    vi.doMock("./plotColumns", () => {
      throw new Error("chunk load failed");
    });
    const { COLUMNS_ROW_THRESHOLD, plotSeries } = await import("./plot");
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    expect(await plotSeries({ dataset: dataset(COLUMNS_ROW_THRESHOLD + 1) })).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(accept(fetchMock)).toBeUndefined();
  });

  it("threads the abort signal through both paths", async () => {
    const { COLUMNS_ROW_THRESHOLD, plotSeries } = await import("./plot");
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    const small = new AbortController();
    const large = new AbortController();
    await plotSeries({ dataset: dataset(3) }, small.signal);
    await plotSeries({ dataset: dataset(COLUMNS_ROW_THRESHOLD + 1) }, large.signal);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(small.signal);
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal).toBe(large.signal);
  });
});
