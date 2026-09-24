import { describe, expect, it } from "vitest";

import type { Dataset, SldPreset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { makeDataset, makeRecord } from "./reflFit.testkit";
import { buildChannel, DEFAULT_SETTINGS } from "./reflFitData";
import { channelDigest, recordsFor, withFitRecord, type ReflFitRecord } from "./reflFitRecord";
import { curveDatasetFor, recordIssues, resolveBinding, restoreSetup } from "./reflFitRestore";

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
];

/** A record whose channel digest matches `data` as it is now. */
function recordFor(d: Dataset, over: Partial<ReflFitRecord> = {}): ReflFitRecord {
  const rec = makeRecord(over, [d.id]);
  const ch = rec.request.channels[0];
  const settings = rec.request.settings;
  ch.digest = channelDigest(buildChannel(d.data, new Set(), ch, settings, "dr", null, "").channel);
  return rec;
}

function roundTrip(datasets: Dataset[]): Dataset[] {
  return parseWorkspace(serializeWorkspace({ datasets })).datasets;
}

describe("resolveBinding — column indices are hints checked against labels", () => {
  const ch = makeRecord().request.channels[0];

  it("keeps a column that is still where it was", () => {
    expect(resolveBinding(ch, makeDataset("xrr"), 1)).toEqual({
      datasetId: "xrr", rCol: 0, drCol: 1, dqCol: null, dqIsFwhm: false, spin: "none",
    });
  });

  it("follows a column that moved, by its label", () => {
    const d = makeDataset("xrr");
    d.data = { ...d.data, labels: ["dR", "R"], values: d.data.values.map(([a, b]) => [b, a]) };
    expect(resolveBinding(ch, d, 1)).toMatchObject({ rCol: 1, drCol: 0 });
  });

  it("fails closed when a column is gone or the dataset was deleted", () => {
    const d = makeDataset("xrr");
    d.data = { ...d.data, labels: ["R", "err"] };
    expect(resolveBinding(ch, d, 1)).toMatch(/missing or renamed/);
    expect(resolveBinding(ch, undefined, 2)).toMatch(/channel 2: its dataset "xrr.refl" is no longer in the library/);
  });
});

describe("recordIssues", () => {
  it("is clean for untouched data, and says so when the data changed", () => {
    const d = makeDataset("xrr");
    const rec = recordFor(d);
    expect(recordIssues(rec, [d])).toEqual({ missing: [], changed: [] });
    const edited = { ...d, data: { ...d.data, values: [[1, 0.1], [0.4, 0.1]] } };
    expect(recordIssues(rec, [edited]).changed).toEqual([`channel 1: the data of "xrr.refl" changed since this fit`]);
    // Excluding a row changes what the fit would send, too.
    expect(recordIssues(rec, [{ ...d, excludedRows: [0] }]).changed).toHaveLength(1);
  });

  it("is recomputed when a channel's dataset changes, not when another dataset does", () => {
    const d = makeDataset("xrr");
    const rec = recordFor(d);
    const first = recordIssues(rec, [d]);
    expect(recordIssues(rec, [d, makeDataset("unrelated")])).toBe(first);
    const edited = { ...d, data: { ...d.data, values: [[1, 0.1], [0.4, 0.1]] } };
    expect(recordIssues(rec, [edited, makeDataset("unrelated")]).changed).toHaveLength(1);
    expect(recordIssues(rec, [d])).toEqual(first);
  });

  it("flags a channel whose dataset was deleted, and says nothing about a still-loading one", () => {
    const a = makeDataset("a");
    const rec = recordFor(a);
    rec.request.channels.push({ ...rec.request.channels[0], datasetId: "b", datasetName: "b.refl" });
    expect(recordIssues(rec, [a]).missing).toEqual([`channel 2: its dataset "b.refl" is no longer in the library`]);
    const pendingB = { ...makeDataset("b"), pending: {} } as unknown as Dataset;
    expect(recordIssues(rec, [a, pendingB])).toEqual({ missing: [], changed: [] });
  });
});

describe("restoreSetup", () => {
  it("restores the model, parameter settings, globals, bindings and data settings", () => {
    const d = makeDataset("xrr");
    const rec = recordFor(d);
    const s = restoreSetup(rec, [d], PRESETS);
    if (typeof s === "string") throw new Error(s);
    expect(s.layers).toEqual(rec.model.layers); // presets unchanged: the snapshot as it was
    expect(s.radiation).toBe("xray");
    expect(s.overrides.layerCount).toBe(3);
    expect(s.overrides.byName["L1.thickness"]).toEqual({ vary: true, min: 100, max: 300, tie: "" });
    expect(s.overrides.byName["L2.roughness"]).toMatchObject({ vary: false, tie: "L1.roughness" });
    expect(s.overrides.byName.background).toMatchObject({ vary: true, min: 0, max: 1e-4 });
    expect(s.globals).toEqual({ scale: 1, background: 0 });
    expect(s.channels).toEqual([{ datasetId: "xrr", rCol: 0, drCol: 1, dqCol: null, dqIsFwhm: false, spin: "none" }]);
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, qMin: 0.01 });
    expect(s.skipped).toEqual([]);
  });

  it("restores the value actually fitted from when a preset's SLD has since changed", () => {
    const d = makeDataset("xrr");
    const rec = recordFor(d);
    rec.request.parameters.push({ name: "L1.sld", value: 7.0e-5, vary: false, min: 0, max: 1, tie: null });
    const s = restoreSetup(rec, [d], PRESETS);
    if (typeof s === "string") throw new Error(s);
    expect(s.layers[1]).toMatchObject({ preset: "", sld: 7.0e-5, isld: 5e-7 });
  });

  it("skips a dangling channel, and refuses when nothing is left", () => {
    const a = makeDataset("a");
    const rec = recordFor(a);
    rec.request.channels.push({ ...rec.request.channels[0], datasetId: "gone", datasetName: "gone.refl" });
    const s = restoreSetup(rec, [a], PRESETS);
    if (typeof s === "string") throw new Error(s);
    expect(s.channels.map((c) => c.datasetId)).toEqual(["a"]);
    expect(s.skipped).toEqual([`channel 2: its dataset "gone.refl" is no longer in the library`]);
    expect(restoreSetup(rec, [], PRESETS)).toMatch(/^cannot restore this fit/);
  });
});

describe("fit-curve datasets", () => {
  it("are named for the fit, placed with the source, and point back at it", () => {
    const d = { ...makeDataset("xrr"), workbookId: "wb-1", folderId: "fld-1" };
    const out = curveDatasetFor(recordFor(d, { seq: 3 }), [d]);
    expect(out.base).toBe("xrr.refl — refl fit #3");
    expect(out.placement).toEqual({ workbookId: "wb-1", folderId: "fld-1" });
    expect(out.metadata({ spin: null })).toMatchObject({
      source: "reflectivity-fit",
      reflFit: { fitId: "rfit-abc-1", seq: 3, sourceIds: ["xrr"], sourceNames: ["xrr.refl"] },
      spin: null,
    });
  });
});

describe("workspace save -> reopen", () => {
  it("keeps the fit history, non-finite values and null stderr intact", () => {
    const d = makeDataset("xrr");
    const rec = recordFor(d);
    rec.result.chi2 = Number.NaN;
    const [older, newer] = [rec, { ...rec, id: "rfit-abc-2", seq: 2 }];
    const withHistory = withFitRecord(withFitRecord([d], older), newer);
    const [reopened] = roundTrip(withHistory);
    const records = recordsFor(reopened);
    expect(records.map((r) => r.seq)).toEqual([2, 1]);
    expect(records[1]).toEqual(older);
    expect(records[1].result.chi2).toBeNaN();
    expect(records[1].request.parameters[1].min).toBe(-Infinity);
    expect(records[1].result.parameters[1].stderr).toBeNull();
    // Reopened, untouched data still matches the fit's digest.
    expect(recordIssues(records[0], [reopened])).toEqual({ missing: [], changed: [] });
  });

  it("reopens with a channel dataset deleted: the record is kept and flagged, nothing throws", () => {
    const pp = makeDataset("pp");
    const mm = makeDataset("mm");
    const rec = makeRecord({}, ["pp", "mm"]);
    const saved = withFitRecord([pp, mm], rec).filter((d) => d.id === "pp"); // mm deleted later
    const [reopened] = roundTrip(saved);
    const [kept] = recordsFor(reopened);
    expect(kept.id).toBe(rec.id);
    expect(recordIssues(kept, [reopened]).missing).toEqual([`channel 2: its dataset "mm.refl" is no longer in the library`]);
  });

  it("is additive-optional: a dataset with no fits writes no field", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [makeDataset("xrr")] }));
    expect("reflFits" in doc.datasets[0]).toBe(false);
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].reflFits).toBeUndefined();
  });

  it("the plain-property optional fields are omitted when absent and written when present", () => {
    // workspaceSerialize.ts writes raw/corrections/bgRef/fitSpec/pending/reflFits
    // as plain properties and relies on JSON dropping `undefined`.
    const bare = JSON.parse(serializeWorkspace({ datasets: [makeDataset("xrr")] }));
    expect(Object.keys(bare.datasets[0])).toEqual(["id", "name", "data"]);
    const d: Dataset = {
      ...makeDataset("xrr"),
      raw: makeDataset("xrr").data,
      corrections: { xOffset: 1 } as Dataset["corrections"],
      bgRef: { datasetId: "bg", interp: "linear" },
      fitSpec: { model: "linear" },
      reflFits: [],
    };
    const full = JSON.parse(serializeWorkspace({ datasets: [d] })).datasets[0];
    expect(Object.keys(full)).toEqual(["id", "name", "data", "raw", "corrections", "bgRef", "fitSpec", "reflFits"]);
  });
});
