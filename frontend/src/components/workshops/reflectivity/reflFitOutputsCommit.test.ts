// Reflectivity fit curves and DREAM bands as ONE multi-output result
// (acceptance C13, audit rows 26/27; owner-approved recommendation 2026-11-23).
import { beforeEach, describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "../../../lib/analysisResult";
import { stampAnalysisResults } from "../../../lib/analysisResultFreshness";
import { staleAnalysisOutputs } from "../../../lib/analysisResultStaleLoad";
import { committedOutputIds, isCommittedOutputResult } from "../../../lib/committedOutputGraph";
import { publishReflectivityFitAnalysisResult } from "./reflFitAnalysisResultPublish";
import { referencedRecordState } from "../../../lib/resultInputsRecord";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { dreamResult, fitResponse, makeRecord, xrrDataset } from "./reflFit.testkit";
import { bandDatasets } from "./reflDreamBands";
import { curveDatasets, savedCurves } from "./reflFitCurves";
import { buildChannel } from "./reflFitData";
import { commitReflFitOutputs, REFL_BANDS_PRODUCER, REFL_CURVES_PRODUCER, REFL_OUTPUTS_NOT_CURRENT } from "./reflFitOutputsCommit";
import { channelDigest, withFitRecord, withPosterior, type ReflFitRecord } from "./reflFitRecord";

const FALLBACK = { weighting: "dr", radiation: "xray" };

/** A record of `d` whose channel digest matches the rows the fit sent. */
function fitted(...ds: Dataset[]): ReflFitRecord {
  const rec = makeRecord({}, ds.map((d) => d.id));
  rec.request.settings = { ...rec.request.settings, qMin: null };
  rec.request.channels.forEach((ch, i) => {
    Object.assign(ch, { rCol: 0, drCol: 1, dqCol: 2, rLabel: "Intensity", drLabel: "uncertainty", dqLabel: "resolution" });
    ch.digest = channelDigest(buildChannel(ds[i]!.data, new Set(), ch, rec.request.settings, "dr", null, "").channel);
  });
  return { ...rec, curves: savedCurves(fitResponse()) };
}

const st = () => useApp.getState();
const results = () => st().analysisResults;
let record: ReflFitRecord;

beforeEach(() => {
  const d = xrrDataset("xrr");
  record = fitted(d);
  useApp.setState({
    datasets: withFitRecord([d], record), activeId: "xrr", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

function addCurves(): string[] {
  return commitReflFitOutputs("add reflectivity fit curves", REFL_CURVES_PRODUCER, record, curveDatasets(record.curves!, record, st().datasets, FALLBACK));
}

function editSource(): void {
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "xrr"
    ? { ...d, data: { ...d.data, values: d.data.values.map((row) => [row[0]! * 2, row[1]!, row[2]!]) } }
    : d) }));
  st().touchDataset("xrr");
}

describe("reflectivity curves: one result lists every worksheet of the fit", () => {
  it("records ALL outputs, outputs[0] primary, each with its part, in ONE undo step", () => {
    const ids = addCurves();
    expect(ids.length).toBe(record.curves!.channels.length + record.curves!.sld.length);
    expect(results()).toHaveLength(1);
    const [result] = results();
    expect(isCommittedOutputResult(result)).toBe(true);
    expect(result.producer).toEqual(REFL_CURVES_PRODUCER);
    expect(result.outputs.map((o) => o.datasetId)).toEqual(ids);
    expect(result.outputs[0]).toEqual({ datasetId: ids[0], role: "linked-worksheet", part: "model" });
    expect(result.outputs.at(-1)!.part).toBe("sld");
    // Points at the stored record (never a copy) and records the fit's inputs.
    expect(result.settingsRef).toMatchObject({ datasetId: "xrr", field: "reflFits", recordId: record.id });
    expect(referencedRecordState(result, st().datasets)).toBe("current");
    expect(result.parameters?.["inputs"]).toMatchObject({ total: 1, items: [{ datasetId: "xrr", includedRows: 6 }] });
    expect(result.stale).toBeUndefined();
    expect(st().history).toHaveLength(1);

    st().undo();
    expect(results()).toHaveLength(0);
    expect(st().datasets.map((d) => d.id)).toEqual(["xrr"]);
  });

  it("a changed source marks EVERY output stale in Manual and Auto mode, none in None, and a recalc pass leaves them stale", async () => {
    const ids = addCurves();
    editSource();
    expect(st().staleDatasets).toEqual(ids);
    expect(committedOutputIds(results())).toEqual(new Set(ids));

    useApp.setState({ staleDatasets: [], recalcMode: "auto" });
    editSource();
    expect(st().staleDatasets).toEqual(ids);
    await st().recalcNow(); // never recomputed: there is no recipe to replay
    expect(st().staleDatasets).toEqual(ids);

    useApp.setState({ staleDatasets: [], recalcMode: "off" });
    editSource();
    expect(st().staleDatasets).toEqual([]);
  });

  it("save and reopen: every output reopens stale when the source changed after the save", () => {
    const ids = addCurves();
    const stamped = stampAnalysisResults(results(), st().datasets, [], []);
    const reopened = sanitizeAnalysisResults(JSON.parse(JSON.stringify(stamped)));
    expect(reopened[0].outputs).toEqual(results()[0].outputs); // parts survive the round trip
    expect(staleAnalysisOutputs(reopened, st().datasets)).toEqual([]);
    const changed = st().datasets.map((d) => d.id === "xrr" ? { ...d, data: { ...d.data, values: d.data.values.map((r) => [r[0]! + 1, r[1]!, r[2]!]) } } : d);
    expect(staleAnalysisOutputs(reopened, changed).sort()).toEqual([...ids].sort());
  });

  it("fails closed: curves of a fit whose data changed since are added, but their result is born stale", () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, values: d.data.values.map((r) => [r[0]! * 3, r[1]!, r[2]!]) } })) }));
    const ids = addCurves();
    const [result] = results();
    expect(result.stale).toBe(true);
    expect(result.warnings).toEqual([REFL_OUTPUTS_NOT_CURRENT]);
    expect(result.parameters).not.toHaveProperty("inputs");
    expect(st().staleDatasets).toEqual(ids);
  });

  it("without a stored record the worksheets are plain (nothing to point at), as before", () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, reflFits: undefined })) }));
    const ids = addCurves();
    expect(ids.length).toBeGreaterThan(0);
    expect(results()).toEqual([]);
    expect(st().history).toHaveLength(1);
  });

  it("bands: one result per run, keyed by the run, parts r-band / sld-band", () => {
    const ranAt = "2026-09-24T11:00:00.000Z";
    const ids = commitReflFitOutputs("add reflectivity uncertainty bands", REFL_BANDS_PRODUCER, record,
      bandDatasets(dreamResult(), record, st().datasets, ranAt), ranAt);
    const [result] = results();
    expect(result.producer).toEqual(REFL_BANDS_PRODUCER);
    expect(result.outputs.map((o) => o.part)).toEqual(ids.map((_, i) => (i === 0 ? "r-band" : "sld-band")));
    expect(result.parameters?.["settings"]).toEqual({ recordId: record.id, ranAt });
    editSource();
    expect(st().staleDatasets).toEqual(ids);
  });

  it("a later DREAM posterior on the record does not make it 'changed' for the curves result", () => {
    addCurves();
    useApp.setState((s) => ({ datasets: withPosterior(s.datasets, record.id, { parameters: [] } as never) }));
    expect(referencedRecordState(results()[0], st().datasets)).toBe("current");
  });

  it("the fit's catalog entry is still published beside a curves result, and the curves result is never retired with it", () => {
    addCurves();
    const curves = results()[0];
    const published = publishReflectivityFitAnalysisResult(st().datasets, results(), record);
    expect(published.map((r) => r.producer.id).sort()).toEqual(["reflectivity-fit", "reflectivity-fit-curves"]);
    // Its record fell out of history (gone from the sources that are present): the catalog entry retires, the curves result stays.
    const trimmed = st().datasets.map((d) => ({ ...d, reflFits: [] }));
    const other = { ...record, id: "rfit-other" };
    const after = publishReflectivityFitAnalysisResult(withFitRecord(trimmed, other), published, other);
    expect(after.some((r) => r.id === curves.id)).toBe(true);
    expect(after.filter((r) => r.producer.id === "reflectivity-fit").map((r) => r.settingsRef)).toEqual([
      expect.objectContaining({ recordId: "rfit-other" }),
    ]);
  });
});

describe("born-stale is only for a real change, never for 'cannot verify yet'", () => {
  const LAZY = { bookId: "b", rows: 1, cols: 1, kind: "path" as const };
  const twoSources = (over: (second: Dataset) => Dataset = (d) => d) => {
    const a = xrrDataset("xrr");
    const b = over(xrrDataset("xrr2"));
    record = fitted(a, xrrDataset("xrr2"));
    useApp.setState({ datasets: withFitRecord([a, b], record) });
  };
  const bornClean = (ids: string[]) => {
    const [result] = results();
    expect(result.stale).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.sourceFingerprint).toBeUndefined(); // nothing was verified: nothing is claimed
    expect(result.parameters).not.toHaveProperty("inputs");
    expect(st().staleDatasets).toEqual([]);
    expect(ids.length).toBeGreaterThan(0);
  };

  it("a lazy, not-yet-loaded source (the other spin channel) leaves the result neither stale nor fingerprinted", () => {
    twoSources((d) => ({ ...d, pending: LAZY }));
    bornClean(addCurves());
  });

  it("a channel stored without a digest cannot be verified: not stale, not fingerprinted", () => {
    const d = xrrDataset("xrr");
    record = { ...fitted(d) };
    record.request.channels[0]!.digest = "";
    useApp.setState({ datasets: withFitRecord([d], record) });
    bornClean(addCurves());
  });

  it("a source that is gone since the fit IS a change: born stale with the reason", () => {
    twoSources();
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "xrr2") }));
    const ids = addCurves();
    const [result] = results();
    expect(result.stale).toBe(true);
    expect(result.warnings).toEqual([REFL_OUTPUTS_NOT_CURRENT]);
    expect(st().staleDatasets).toEqual(ids);
  });

  it("a change beats a pending source: one changed, one lazy is still stale", () => {
    twoSources((d) => ({ ...d, pending: LAZY }));
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "xrr" ? { ...d, data: { ...d.data, values: d.data.values.map((r) => [r[0]! * 3, r[1]!, r[2]!]) } } : d) }));
    addCurves();
    expect(results()[0].stale).toBe(true);
  });

  it("recalc mode None tracks nothing: a changed source adds no stale mark and no false message", () => {
    useApp.setState((s) => ({ recalcMode: "off", datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, values: d.data.values.map((r) => [r[0]! * 3, r[1]!, r[2]!]) } })) }));
    addCurves();
    const [result] = results();
    expect(result.stale).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(st().staleDatasets).toEqual([]);
  });

  it("recalc mode None still verifies an unchanged fit (fingerprint recorded, inputs recorded)", () => {
    useApp.setState({ recalcMode: "off" });
    addCurves();
    expect(results()[0].sourceFingerprint).toBeDefined();
    expect(results()[0].parameters).toHaveProperty("inputs");
  });
});

describe("re-adding after the previous worksheets were deleted", () => {
  it("replaces the orphaned same-key result instead of leaving a second, output-less one", () => {
    const first = addCurves();
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => !first.includes(d.id)) }));
    expect(results()).toHaveLength(1); // the orphan: every output gone
    const second = addCurves();
    expect(results()).toHaveLength(1);
    expect(results()[0].outputs.map((o) => o.datasetId)).toEqual(second);
    st().undo(); // one undo step: back to the orphan, nothing lost
    expect(results()).toHaveLength(1);
    expect(results()[0].outputs.map((o) => o.datasetId)).toEqual(first);
  });

  it("keeps a same-key result that still has a worksheet, and results of other fits", () => {
    const first = addCurves();
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== first[0]) }));
    addCurves();
    expect(results()).toHaveLength(2);
  });
});
