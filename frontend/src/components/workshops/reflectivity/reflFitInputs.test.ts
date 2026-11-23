import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { dreamResult, fitResponse, makeRecord, xrrDataset } from "./reflFit.testkit";
import { bandDatasets } from "./reflDreamBands";
import { curveDatasets, existingFitDatasetIds, savedCurves } from "./reflFitCurves";
import { buildChannel } from "./reflFitData";
import { channelDigest, type ReflFitRecord } from "./reflFitRecord";

/** A record of `d` whose channel digest matches the rows the fit sent (`dropped` left out). */
function fitted(d: Dataset, dropped = new Set<number>()): ReflFitRecord {
  const rec = makeRecord({}, [d.id]);
  const ch = rec.request.channels[0];
  Object.assign(ch, { rCol: 0, drCol: 1, dqCol: 2, rLabel: "Intensity", drLabel: "uncertainty", dqLabel: "resolution" });
  rec.request.settings = { ...rec.request.settings, qMin: null };
  ch.digest = channelDigest(buildChannel(d.data, dropped, ch, rec.request.settings, "dr", null, "").channel);
  return { ...rec, curves: savedCurves(fitResponse()) };
}

const FALLBACK = { weighting: "dr", radiation: "xray" };

describe("C9 inputs of reflectivity curve and band worksheets (audit rows 26 and 27)", () => {
  it("fit curves record the source, its channels and the rows and Q range the fit actually sent", () => {
    const d = xrrDataset("xrr", { excludedRows: [0] });
    const rec = fitted(d, new Set([0]));
    const curves = curveDatasets(rec.curves!, rec, [d], FALLBACK);
    expect(curves.length).toBeGreaterThan(0);
    for (const c of curves) {
      expect(c.data.metadata.inputs).toEqual({
        total: 1,
        items: [expect.objectContaining({
          datasetId: "xrr",
          channelCount: 3,
          rows: 6,
          includedRows: 5, // the excluded row is not an input
          xRange: [0.02, 0.06], // the time axis (Q) of the sent rows
          xUnit: "1/Ang",
          channels: [
            { index: 0, label: "Intensity", unit: "arb. units" },
            { index: 1, label: "uncertainty", unit: "arb. units" },
            { index: 2, label: "resolution", unit: "1/Ang" },
          ],
        })],
      });
    }
  });

  it("the range follows the fit's own Q window, not the whole worksheet", () => {
    const d = xrrDataset("xrr");
    const rec = fitted(d);
    rec.request.settings = { ...rec.request.settings, qMin: 0.03, qMax: 0.05 };
    rec.request.channels[0].digest = channelDigest(buildChannel(d.data, new Set(), rec.request.channels[0], rec.request.settings, "dr", null, "").channel);
    const [model] = curveDatasets(rec.curves!, rec, [d], FALLBACK);
    expect(model.data.metadata.inputs).toMatchObject({ items: [{ includedRows: 3, xRange: [0.03, 0.05] }] });
  });

  it("uncertainty bands record the same inputs", () => {
    const d = xrrDataset("xrr", { excludedRows: [0] });
    const rec = fitted(d, new Set([0]));
    const [r, sld] = bandDatasets(dreamResult(), rec, [d], "2026-09-24T11:00:00.000Z");
    for (const band of [r, sld]) {
      expect(band.data.metadata.inputs).toMatchObject({ total: 1, items: [{ datasetId: "xrr", includedRows: 5, xRange: [0.02, 0.06] }] });
    }
  });

  it("writes NO record when the data changed since the fit (fail closed), and the worksheet is still made", () => {
    const d = xrrDataset("xrr");
    const rec = fitted(d);
    const changed = { ...d, data: { ...d.data, values: d.data.values.map((row) => [row[0] * 2, row[1], row[2]]) } };
    const [model] = curveDatasets(rec.curves!, rec, [changed], FALLBACK);
    expect(model.data.metadata).not.toHaveProperty("inputs");
    expect(model.data.metadata).toMatchObject({ source: "reflectivity-fit", reflFit: { fitId: rec.id } });
    expect(curveDatasets(rec.curves!, rec, [], FALLBACK)[0].data.metadata).not.toHaveProperty("inputs");
  });

  it("the record is not identity: a curve worksheet saved without it is still found as the earlier add", () => {
    const d = xrrDataset("xrr");
    const rec = fitted(d);
    const made = curveDatasets(rec.curves!, rec, [d], FALLBACK).map((c, i) => ({ id: `c${i}`, name: c.name, data: c.data }));
    const legacy = made.map((c) => {
      const { inputs: _inputs, ...rest } = c.data.metadata;
      return { ...c, data: { ...c.data, metadata: rest } };
    });
    const expected = rec.curves!.channels.length + rec.curves!.sld.length;
    expect(existingFitDatasetIds(rec.id, made, expected)).toEqual(["c0", "c1"]);
    expect(existingFitDatasetIds(rec.id, legacy, expected)).toEqual(["c0", "c1"]);
  });
});
