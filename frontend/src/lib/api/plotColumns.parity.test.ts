// End-to-end parity of the two /api/plot/series transports: the SAME server
// answer, once as JSON and once as a column frame, must draw the same plot --
// not just decode to equal values. Each payload goes through the real
// `fetchPlot` (so `plotSeries`' row-threshold switch and `fromResponse` /
// `dropTrailingEmptyRows` run) and then through the consumers that reshape or
// persist columns: the display compose (waterfall, grey exclusion, selection
// brush), the group split, the snapshot freeze -> JSON -> sanitize round trip,
// and the clipboard export.
//
// Gap contract (Q2, relaxed on purpose in R4): a column with a gap is a plain
// `Array` and `null` is its only gap (never NaN, -0 kept); a gap-free column
// is a `Float64Array` (a 1M x 7 decode from a clean heap drops from ~400 to
// ~150-220 ms median, docs/performance_envelope.md). Payloads are compared value for value via
// `Array.from`. The consumers below were made typed-safe for that (a mask /
// brush / split / categorical remap builds a plain array through
// `lib/plotColumnOps.ts`, the snapshot freeze copies typed columns plain), so
// every derived result must still equal the JSON path's, and no derived
// column may be both typed and in need of a gap.

import { afterEach, describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/plotSeriesColumns.json";
import { COLUMNS_MEDIA_TYPE } from "./plotColumns";
import { COLUMNS_ROW_THRESHOLD } from "./plot";
import { payloadToTSV } from "../clipboard";
import { composeDisplayPayload, fetchPlot, type PlotPayload } from "../plotdata";
import { applyGroupSplit } from "../plotGroupSplit";
import { freezePlotSnapshot, sanitizeFrozenBundle } from "../plotsnapshot";
import type { DataStruct, PlotSeriesResponse } from "../types";

type Json = PlotSeriesResponse;

const base64Bytes = (b64: string): ArrayBuffer => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** The frame the server writes for a JSON body: same header, `null` -> NaN.
 *  Only for the hand-built case; the fixture case uses the server's bytes. */
function frameOf(json: Json): ArrayBuffer {
  const { data, ...rest } = json;
  const nRows = data[0]?.length ?? 0;
  let text = JSON.stringify({ ...rest, n_columns: data.length, n_rows: nRows });
  text += " ".repeat((8 - ((8 + text.length) % 8)) % 8);
  const head = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(8 + head.length + data.length * nRows * 8);
  new Uint8Array(buf).set([0x51, 0x5a, 0x43, 0x31], 0);
  const dv = new DataView(buf);
  dv.setUint32(4, head.length, true);
  new Uint8Array(buf).set(head, 8);
  let at = 8 + head.length;
  for (const col of data) {
    for (const v of col) {
      dv.setFloat64(at, v ?? NaN, true);
      at += 8;
    }
  }
  return buf;
}

const response = (body: unknown, type: string): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(body),
    headers: { get: (n: string) => (n === "Content-Type" ? type : null) },
  }) as unknown as Response;

/** A dataset only sizes the request (the server is mocked). Its label is
 *  deliberately foreign, so an offline `buildColumns` fallback could never
 *  pass for a server answer. */
const dataset = (rows: number): DataStruct => ({
  time: Array.from({ length: rows }, (_, i) => i),
  values: Array.from({ length: rows }, () => [0]),
  labels: ["not-the-server"],
  units: [""],
  metadata: {},
});

/** Fetch the same answer over both transports through the real `fetchPlot`. */
async function bothPaths(json: Json, frame: ArrayBuffer): Promise<{ viaJson: PlotPayload; viaColumns: PlotPayload }> {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(structuredClone(json), "application/json"))
    .mockResolvedValueOnce(response(frame, COLUMNS_MEDIA_TYPE));
  vi.stubGlobal("fetch", fetchMock);
  const viaJson = await fetchPlot(dataset(3), false);
  const viaColumns = await fetchPlot(dataset(COLUMNS_ROW_THRESHOLD + 1), false);
  const accepts = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).headers as Record<string, string>);
  expect(accepts[0].Accept).toBeUndefined(); // the JSON path, untouched
  expect(accepts[1].Accept).toContain(COLUMNS_MEDIA_TYPE);
  return { viaJson, viaColumns };
}

type Col = ArrayLike<number | null | undefined>;
const valuesOf = (p: PlotPayload) => ({ ...p, data: p.data.map((c: Col) => Array.from(c)) });

/** Same values as the oracle (Object.is, so -0 and null are exact); a typed
 *  column is a Float64Array of finite values, a plain one holds no NaN. With
 *  `strict`, a column is typed exactly when the oracle's has no gap -- the
 *  decoder's own contract. */
function expectColumns(p: PlotPayload, oracle: PlotPayload, strict = false): void {
  expect(p.data.length).toBe(oracle.data.length);
  for (const [c, col] of (p.data as Col[]).entries()) {
    const want = Array.from(oracle.data[c] as Col);
    const got = Array.from(col);
    expect(got.length, `column ${c} length`).toBe(want.length);
    got.forEach((v, r) => {
      expect(Object.is(v, want[r]), `column ${c} row ${r}: ${String(v)} vs ${String(want[r])}`).toBe(true);
    });
    if (ArrayBuffer.isView(col)) {
      expect(col, `column ${c} is a Float64Array`).toBeInstanceOf(Float64Array);
      expect(got.every((v) => Number.isFinite(v)), `typed column ${c} has no gap`).toBe(true);
    } else {
      expect(Array.isArray(col), `column ${c} is a plain Array`).toBe(true);
      expect(got.some((v) => Number.isNaN(v)), `column ${c} has no NaN`).toBe(false);
    }
    if (strict) expect(ArrayBuffer.isView(col), `column ${c} typed iff gap-free`).toBe(!want.includes(null));
  }
}

/** The consumers that reshape or persist columns, applied identically. */
function derived(p: PlotPayload) {
  const n = p.data[0].length;
  const compose = (dropped: number[]) =>
    composeDisplayPayload(p, {
      id: "d",
      waterfall: 0.25,
      dropped: new Set(dropped),
      excludedDisplay: "grey",
      fitOverlay: null,
      baselineOverlay: null,
      peakOverlay: null,
      derivOverlay: null,
      selection: { datasetId: "d", rows: [1, n - 1] },
    });
  const display = compose([0, 3]);
  // Nothing excluded: the selection brush runs on the decoded columns themselves.
  const brushed = compose([]);
  const codes = Array.from({ length: n }, (_, r) => r % 2);
  const grouped = applyGroupSplit(p, codes, "g", (c) => `L${c}`);
  const frozen = freezePlotSnapshot({
    payload: display,
    styleList: undefined,
    labelList: undefined,
    errorBars: new Map(),
    plotted: [],
    colorByColumns: new Map(),
    hidden: undefined,
  });
  const reloaded = sanitizeFrozenBundle(JSON.parse(JSON.stringify(frozen)));
  return { display, brushed, grouped, reloaded, tsv: payloadToTSV(display) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("columns path vs JSON path: identical plots", () => {
  const cases: [string, () => { json: Json; frame: ArrayBuffer }][] = [
    // The server's own bytes: gaps, -0, an all-gap row pair, a y2 series and
    // an all-finite x column.
    ["server fixture", () => ({ json: fixture.json as Json, frame: base64Bytes(fixture.columns_base64) })],
    // The same answer plus an all-finite Y column: a typed Y column through
    // the mask, brush, waterfall and group split.
    [
      "fixture + an all-finite y column",
      () => {
        const src = fixture.json as Json;
        const json: Json = {
          ...src,
          data: [...src.data, src.data[0].map((_, r) => 0.5 * r - 1)],
          series: [...src.series, { label: "d", unit: "", axis: 0 }],
        };
        return { json, frame: frameOf(json) };
      },
    ],
  ];

  it.each(cases)("%s", async (_name, make) => {
    const { json, frame } = make();
    const { viaJson, viaColumns } = await bothPaths(json, frame);

    expect(viaColumns.series.map((s) => s.label)).not.toContain("not-the-server");
    expect(valuesOf(viaColumns)).toEqual(valuesOf(viaJson));
    expectColumns(viaColumns, viaJson, true);
    expect(viaColumns.data.some((c) => ArrayBuffer.isView(c))).toBe(true); // the fast path is exercised

    const a = derived(viaJson);
    const b = derived(viaColumns);
    expect(valuesOf(b.display)).toEqual(valuesOf(a.display));
    expectColumns(b.display, a.display);
    expect(valuesOf(b.brushed)).toEqual(valuesOf(a.brushed));
    expectColumns(b.brushed, a.brushed);
    expect(valuesOf(b.grouped)).toEqual(valuesOf(a.grouped));
    expectColumns(b.grouped, a.grouped);
    expect(a.reloaded).not.toBeNull();
    expect(b.reloaded).toEqual(a.reloaded);
    expect(b.tsv).toBe(a.tsv);
  });
});
