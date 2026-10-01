// The import routes now return the parsed dataset's `X-Dataset-Handle`
// (routes/parsers.py). Before, the first plot after an upload POSTed every row
// straight back to the server that had just parsed it (1M x 6: ~5 s of JSON).
// Pinned by what crosses the wire, not by a clock: the first plot's request is
// a handle of a few dozen bytes, and an expired handle falls back to the full
// dataset through the existing 409 path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../api";
import { plotSeries } from "./plot";
import type { DataStruct } from "../types";

const ROWS = 2_000; // under the binary-column threshold: the JSON path

function payload(rows = ROWS): DataStruct {
  return {
    time: Array.from({ length: rows }, (_, i) => i),
    values: Array.from({ length: rows }, (_, i) => [i * 0.5, i % 7]),
    labels: ["a", "b"],
    units: ["", ""],
    metadata: {},
  };
}

const SERIES = { x: [0], series: [], x_label: "t", x_unit: "" };

function json(body: unknown, status = 200, handle?: string): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (handle) headers["X-Dataset-Handle"] = handle;
  return new Response(JSON.stringify(body), { status, headers });
}

let fetchMock: ReturnType<typeof vi.fn>;
/** The request bodies the plot route received, in order. */
const plotBodies = (): string[] =>
  fetchMock.mock.calls.filter(([path]) => path === "/api/plot/series").map(([, init]) => String(init.body));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the first plot after an import", () => {
  it("references the uploaded dataset by handle instead of re-sending its rows", async () => {
    fetchMock.mockResolvedValueOnce(json(payload(), 200, "h-upload"));
    fetchMock.mockResolvedValueOnce(json(SERIES));
    const ds = await uploadFile(new File(["t,a,b"], "big.csv"));

    await plotSeries({ dataset: ds });

    const [body] = plotBodies();
    expect(JSON.parse(body)).toEqual({ dataset_handle: "h-upload" });
    expect(body.length).toBeLessThan(100); // independent of the row count
  });

  it("does the same for a path import", async () => {
    fetchMock.mockResolvedValueOnce(json(payload(), 200, "h-path"));
    fetchMock.mockResolvedValueOnce(json(SERIES));
    const ds = await importFile("/data/big.csv");

    await plotSeries({ dataset: ds });

    expect(JSON.parse(plotBodies()[0])).toEqual({ dataset_handle: "h-path" });
  });

  it("re-sends the full dataset once when the handle has expired (409)", async () => {
    fetchMock.mockResolvedValueOnce(json(payload(), 200, "h-gone"));
    fetchMock.mockResolvedValueOnce(json({ detail: "unknown_dataset_handle" }, 409));
    fetchMock.mockResolvedValueOnce(json(SERIES, 200, "h-new"));
    const ds = await uploadFile(new File(["t,a,b"], "big.csv"));

    const res = await plotSeries({ dataset: ds });

    expect(res).toEqual(SERIES);
    const [first, retry] = plotBodies();
    expect(JSON.parse(first)).toEqual({ dataset_handle: "h-gone" });
    expect(JSON.parse(retry).dataset.time).toHaveLength(ROWS);
  });

  it("posts the dataset when the upload advertised no handle (too large to cache)", async () => {
    fetchMock.mockResolvedValueOnce(json(payload()));
    fetchMock.mockResolvedValueOnce(json(SERIES));
    const ds = await uploadFile(new File(["t,a,b"], "big.csv"));

    await plotSeries({ dataset: ds });

    expect(JSON.parse(plotBodies()[0]).dataset.time).toHaveLength(ROWS);
  });
});
