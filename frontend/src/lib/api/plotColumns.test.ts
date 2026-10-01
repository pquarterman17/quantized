// The binary column transport's decoder and fetch primitive. The parity case
// decodes the SERVER's actual bytes (`__fixtures__/plotSeriesColumns.json`,
// regenerated and freshness-checked by `tests/test_routes_columns.py`) and
// deep-equals the JSON payload the same request produced, so the two paths
// can never drift apart unnoticed: NaN gaps, -0.0, an all-gap row pair and a
// secondary-axis series all ride through.

import { afterEach, describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/plotSeriesColumns.json";
import { COLUMNS_MEDIA_TYPE, decodeColumns, plotSeriesColumns } from "./plotColumns";
import type { PlotSeriesResponse } from "../types";

const fixtureBytes = (): ArrayBuffer => {
  const bin = atob(fixture.columns_base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** Build a frame by hand: magic, uint32 header length, space-padded header,
 *  then the columns as little-endian float64 -- the layout
 *  `routes/_columns.py` documents. Lets a test plant values (±Infinity) the
 *  JSON request path can never deliver to the server. */
function frame(header: Record<string, unknown>, columns: number[][], opts: { pad?: number } = {}): ArrayBuffer {
  const nRows = columns[0]?.length ?? 0;
  let text = JSON.stringify({ ...header, n_columns: columns.length, n_rows: nRows });
  const pad = opts.pad ?? (8 - ((8 + text.length) % 8)) % 8;
  text += " ".repeat(pad);
  const headerBytes = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(8 + headerBytes.length + columns.length * nRows * 8);
  const bytes = new Uint8Array(buf);
  bytes.set([0x51, 0x5a, 0x43, 0x31], 0); // "QZC1"
  new DataView(buf).setUint32(4, headerBytes.length, true);
  bytes.set(headerBytes, 8);
  const dv = new DataView(buf);
  let at = 8 + headerBytes.length;
  for (const col of columns) {
    for (const v of col) {
      dv.setFloat64(at, v, true);
      at += 8;
    }
  }
  return buf;
}

const HEADER = { series: [{ label: "a", unit: "", axis: 0 }], x: { label: "t", unit: "s", log: false }, y: { log: false } };

describe("decodeColumns", () => {
  it("decodes the server's bytes into exactly the JSON payload (NaN gaps -> null, -0 kept)", () => {
    const decoded = decodeColumns(fixtureBytes());
    expect(decoded).toEqual(fixture.json);
    // toEqual treats 0 and -0 alike; the sign is a separate promise.
    expect(Object.is(decoded.data[2][0], -0)).toBe(true);
    expect(decoded.data[1][1]).toBeNull();
    expect(decoded.data[1].slice(4, 6)).toEqual([null, null]);
    expect(decoded.series[2].axis).toBe(1);
    expect(decoded.data[0].length).toBe(fixture.json.data[0].length);
  });

  it("maps ±Infinity to null too -- every non-finite value is a gap, as on the JSON path", () => {
    const decoded = decodeColumns(frame(HEADER, [[0, 1, 2], [Infinity, -Infinity, NaN]]));
    expect(decoded.data).toEqual([
      [0, 1, 2],
      [null, null, null],
    ]);
    expect(decoded.series).toEqual(HEADER.series);
  });

  it("handles zero rows and zero series", () => {
    expect(decodeColumns(frame(HEADER, [[], []])).data).toEqual([[], []]);
    expect(decodeColumns(frame(HEADER, [])).data).toEqual([]);
  });

  it("rejects a foreign, misaligned, truncated or over-long body", () => {
    const good = frame(HEADER, [[1, 2], [3, 4]]);
    expect(() => decodeColumns(new TextEncoder().encode('{"data":[]}').buffer as ArrayBuffer)).toThrow();
    const badMagic = good.slice(0);
    new Uint8Array(badMagic).set([0x4e, 0x4f, 0x50, 0x45], 0);
    expect(() => decodeColumns(badMagic)).toThrow(/magic|frame/);
    expect(() => decodeColumns(good.slice(0, good.byteLength - 8))).toThrow();
    const long = new Uint8Array(good.byteLength + 8);
    long.set(new Uint8Array(good), 0);
    expect(() => decodeColumns(long.buffer)).toThrow();
    expect(() => decodeColumns(frame(HEADER, [[1, 2]], { pad: 1 }))).toThrow(/aligned/);
    expect(() => decodeColumns(new ArrayBuffer(4))).toThrow();
  });
});

const fakeResponse = (
  body: unknown,
  opts: { ok?: boolean; status?: number; handle?: string; type?: string } = {},
): Response =>
  ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.ok === false ? "Error" : "OK",
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(body),
    headers: {
      get: (name: string) =>
        name === "X-Dataset-Handle" ? (opts.handle ?? null) : name === "Content-Type" ? (opts.type ?? null) : null,
    },
  }) as unknown as Response;

const dataset = () => ({ time: [1, 2, 3], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {} });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plotSeriesColumns", () => {
  it("asks for the column media type and decodes a binary response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeResponse(fixtureBytes(), { type: COLUMNS_MEDIA_TYPE }));
    vi.stubGlobal("fetch", fetchMock);
    const got = await plotSeriesColumns({ dataset: dataset() });
    expect(got).toEqual(fixture.json);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Accept).toContain(COLUMNS_MEDIA_TYPE);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("takes a JSON response as-is when the server did not answer in binary", async () => {
    const json: PlotSeriesResponse = { ...(fixture.json as PlotSeriesResponse) };
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeResponse(json, { type: "application/json" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await plotSeriesColumns({ dataset: dataset() })).toBe(json);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-requests as JSON when a binary body fails to decode", async () => {
    const json = fixture.json as PlotSeriesResponse;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(new ArrayBuffer(12), { type: COLUMNS_MEDIA_TYPE, handle: "h-bin" }))
      .mockResolvedValueOnce(fakeResponse(json, { type: "application/json", handle: "h-json" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await plotSeriesColumns({ dataset: dataset() })).toBe(json);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map((c) => c[1] as RequestInit);
    expect(second.body).toBe(first.body); // the identical request, only the Accept differs
    expect((second.headers as Record<string, string>).Accept).toBe("application/json");
  });

  it("earns a dataset handle through the binary path and reuses it on the next call", async () => {
    const ds = dataset();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(fixtureBytes(), { type: COLUMNS_MEDIA_TYPE, handle: "h1" }))
      .mockResolvedValueOnce(fakeResponse(fixtureBytes(), { type: COLUMNS_MEDIA_TYPE, handle: "h1" }));
    vi.stubGlobal("fetch", fetchMock);
    await plotSeriesColumns({ dataset: ds, x_log: false });
    await plotSeriesColumns({ dataset: ds, x_log: true });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.dataset).toBeUndefined();
    expect(second.dataset_handle).toBe("h1");
  });

  it("surfaces the backend's error detail unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(fakeResponse({ detail: "x_key out of range" }, { ok: false, status: 422 })),
    );
    await expect(plotSeriesColumns({ dataset: dataset(), x_key: 9 })).rejects.toThrow("x_key out of range");
  });
});
