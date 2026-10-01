// End-to-end parity of the two /api/plot/series transports: the SAME server
// answer, once as JSON and once as a column frame, must draw the same plot --
// not just decode to equal values. Each payload goes through the real
// `fetchPlot` (so `plotSeries`' row-threshold switch and `fromResponse` /
// `dropTrailingEmptyRows` run) and then through the consumers that reshape or
// persist columns: the display compose (waterfall, grey exclusion, selection
// brush), the group split, the snapshot freeze -> JSON -> sanitize round trip,
// and the clipboard export.
//
// Gap contract (pinned here, Q2): every decoded column is a plain `Array` and
// `null` is its only gap. A `Float64Array` with NaN gaps would decode in ~0 ms
// instead of ~300+ ms at 1M x 7 (docs/performance_envelope.md), but the
// consumers below are not typed-array safe: `Float64Array.prototype.map`
// coerces the `null` a mask/brush/split writes to 0 (a drawn point at y = 0
// where a gap belongs), and a snapshot holding one serializes as an object and
// is dropped on reload. Every assertion below fails if a typed array leaks.

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

/** Every column a real Array, gaps `null` (never NaN), -0 kept where JSON kept it. */
function expectArrayColumns(p: PlotPayload, oracle: PlotPayload): void {
  for (const [c, col] of (p.data as unknown[]).entries()) {
    expect(Array.isArray(col), `column ${c} is a plain Array`).toBe(true);
    const want = oracle.data[c] as (number | null)[];
    (col as (number | null)[]).forEach((v, r) => {
      expect(Number.isNaN(v), `column ${c} row ${r} is not NaN`).toBe(false);
      expect(Object.is(v, want[r]), `column ${c} row ${r}: ${String(v)} vs ${String(want[r])}`).toBe(true);
    });
  }
}

/** The consumers that reshape or persist columns, applied identically. */
function derived(p: PlotPayload) {
  const n = p.data[0].length;
  const display = composeDisplayPayload(p, {
    id: "d",
    waterfall: 0.25,
    dropped: new Set([0, 3]),
    excludedDisplay: "grey",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: { datasetId: "d", rows: [1, n - 1] },
  });
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
  return { display, grouped, reloaded, tsv: payloadToTSV(display) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("columns path vs JSON path: identical plots", () => {
  const cases: [string, () => { json: Json; frame: ArrayBuffer }][] = [
    // The server's own bytes: gaps, -0, an all-gap row pair, a y2 series and
    // an all-finite x column.
    ["server fixture", () => ({ json: fixture.json as Json, frame: base64Bytes(fixture.columns_base64) })],
    // The same answer plus an all-finite Y column -- the column a "typed
    // array when gap-free" decoder would hand out first.
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
    expect(viaColumns).toEqual(viaJson);
    expectArrayColumns(viaColumns, viaJson);

    const a = derived(viaJson);
    const b = derived(viaColumns);
    expect(b.display).toEqual(a.display);
    expectArrayColumns(b.display, a.display);
    expect(b.grouped).toEqual(a.grouped);
    expectArrayColumns(b.grouped, a.grouped);
    expect(a.reloaded).not.toBeNull();
    expect(b.reloaded).toEqual(a.reloaded);
    expect(b.tsv).toBe(a.tsv);
  });
});
