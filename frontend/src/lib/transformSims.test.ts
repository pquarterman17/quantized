// P2.3 SIMS depth profiles — the recordable `sims` transform: the request it
// sends (reference and RSFs resolved BY NAME, refused when missing or
// ambiguous), the replay validation, provenance stamping, the commit through
// lib/transformRun (undo + recorded step), a replay onto a file whose columns
// come in another order, and the .dwk round trip.

import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsProcessRequest, SimsProcessResult } from "./api/sims";
import { runTransform, transformParamsOf, transformStepText } from "./transformRun";
import { computeSims, simsParamsOf, simsRequest, simsWireDataset, speciesOf, type SimsParams } from "./transformSims";
import type { DataStruct } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { useApp } from "../store/useApp";

vi.mock("./api/sims", () => ({ processSims: vi.fn() }));
const { processSims } = await import("./api/sims");

/** Stand-in backend: divides every column by the reference and echoes the stages. */
function fakeBackend(body: SimsProcessRequest): Promise<SimsProcessResult> {
  const { time, values, labels, units, metadata } = body.dataset;
  const ref = body.normalization?.reference;
  const out = values.map((row) => row.map((v, c) => (ref === undefined || c === ref ? v : (v as number) / (row[ref] as number))));
  const stage = { stage: "normalization", reference: ref === undefined ? null : labels[ref] };
  return Promise.resolve({
    dataset: { time, values: out, labels, units, metadata: { ...metadata, sims_processing: [stage] } },
    warnings: [{ code: "non-positive", text: "1 value is <= 0 and will not show on a log axis", count: 1, info: true }],
    stages: [stage],
  });
}

const profile: DataStruct = {
  time: [0, 1, 2],
  values: [[10, 1000], [20, 1000], [5, 500]],
  labels: ["B", "Si"],
  units: ["c/s", "c/s"],
  metadata: { x_column_name: "Time", x_column_unit: "s" },
};
// The same species, columns swapped — a second file in a template batch.
const swapped: DataStruct = { ...profile, values: [[2000, 40], [2000, 20], [1000, 10]], labels: ["Si", "B"] };

const NORM: SimsParams = { op: "sims", normalization: { reference: "Si" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(processSims).mockImplementation(fakeBackend);
  useApp.setState({
    datasets: [
      { id: "p1", name: "run1.csv", data: profile },
      { id: "p2", name: "run2.csv", data: swapped },
    ],
    folders: [],
    activeId: "p1",
    selectedIds: ["p1"],
    macroRecording: true,
    macroSteps: [],
  });
});

describe("simsWireDataset / speciesOf (finding 10 dedupe)", () => {
  it("projects exactly the wire fields, dropping anything else on the DataStruct", () => {
    const withExtra = { ...profile, fitSpec: { model: "linear" } } as unknown as DataStruct;
    expect(simsWireDataset(withExtra)).toEqual({
      time: profile.time, values: profile.values, labels: profile.labels, units: profile.units,
      metadata: profile.metadata, cat_levels: undefined, level_order: undefined,
    });
  });

  it("keeps every non-categorical column, in order", () => {
    const withCat = { ...profile, labels: ["B", "Si", "grp"], cat_levels: { 2: ["a", "b"] } };
    expect(speciesOf(withCat)).toEqual(["B", "Si"]);
    expect(speciesOf(profile)).toEqual(["B", "Si"]); // no cat_levels at all
  });
});

describe("simsRequest", () => {
  it("maps every stage to the wire shape, the reference and RSFs by NAME", () => {
    const body = simsRequest(
      {
        op: "sims",
        calibration: { method: "crater", craterDepth: 1.2, craterUnit: "um", depthUnit: "nm" },
        background: { lo: 900, hi: 1200, keep: ["B"] },
        normalization: { reference: "Si", rsf: { B: 3e22 }, rsfUnit: "atoms/cm3" },
        smoothing: { method: "savitzky-golay", window: 3, polyOrder: 2 },
      },
      swapped,
    );
    expect(body.calibration).toMatchObject({ method: "crater", crater_depth: 1.2, crater_unit: "um", total_time: null, time_unit: null });
    expect(body.background).toEqual({ lo: 900, hi: 1200, keep: [1] });
    expect(body.normalization).toEqual({ reference: 0, rsf: [null, 3e22], rsf_unit: "atoms/cm3" });
    expect(body.smoothing).toEqual({ method: "savitzky-golay", window: 3, poly_order: 2 });
  });

  it("refuses a reference or RSF column the dataset does not have, or has twice", () => {
    expect(() => simsRequest({ op: "sims", normalization: { reference: "O" } }, profile)).toThrow('no column "O"');
    expect(() => simsRequest({ op: "sims", normalization: { reference: "Si", rsf: { P: 1 } } }, profile)).toThrow('no column "P"');
    expect(() => simsRequest({ op: "sims", background: { lo: 0, hi: 1, keep: ["O"] } }, profile)).toThrow('no column "O"');
    const dup = { ...profile, labels: ["Si", "Si"] };
    expect(() => simsRequest(NORM, dup)).toThrow('2 columns named "Si"');
  });
});

describe("simsRequest — time-unit override replay safety (finding 2)", () => {
  const withOverride: SimsParams = {
    op: "sims",
    calibration: { method: "rate", sputterRate: 1, depthUnit: "nm", timeUnit: "s" },
  };

  it("the preview always forwards a stated override so its confirm warning can show", () => {
    expect(simsRequest(withOverride, profile, { preview: true }).calibration?.time_unit).toBe("s");
  });

  it("commit forwards it only for the EXACT (recorded, stated) pair it was accepted for", () => {
    const blankX: DataStruct = { ...profile, metadata: {} }; // recorded x unit "" at accept time
    const accepted: SimsParams = {
      op: "sims",
      calibration: { ...withOverride.calibration!, acceptedTimeUnit: ["", "s"] },
    };
    expect(simsRequest(accepted, blankX).calibration?.time_unit).toBe("s");
    // A replay onto a file already calibrated to depth ("nm") is NOT the
    // accepted pair -- dropped, so the backend's own recorded-unit check
    // decides (never silently double-calibrated).
    const nmFile: DataStruct = { ...profile, metadata: { x_column_unit: "nm" } };
    expect(simsRequest(accepted, nmFile).calibration?.time_unit).toBeNull();
  });

  it("a target whose x is already a time unit needs no override -- dropped, not thrown", () => {
    const secondsFile: DataStruct = { ...profile, metadata: { x_column_unit: "s" } };
    expect(simsRequest(withOverride, secondsFile).calibration?.time_unit).toBeNull();
  });

  it("without preview or an accepted pair, an unstated calibration sends no override", () => {
    const noOverride: SimsParams = { op: "sims", calibration: { method: "rate", sputterRate: 1, depthUnit: "nm" } };
    expect(simsRequest(noOverride, profile).calibration?.time_unit).toBeNull();
  });
});

describe("simsParamsOf (replay validation)", () => {
  it("round-trips a full recipe", () => {
    const p: SimsParams = {
      op: "sims",
      calibration: { method: "rate", sputterRate: 0.8, rateUnit: "nm/s", depthUnit: "um", timeUnit: "min" },
      background: { lo: 1, hi: 2, keep: ["Si"] },
      normalization: { reference: "Si", rsf: { B: 2e21 }, rsfUnit: "atoms/cm3" },
      smoothing: { method: "moving", window: 2, polyOrder: 2 },
    };
    expect(simsParamsOf(JSON.parse(JSON.stringify(p)) as Record<string, unknown>)).toEqual(p);
    expect(transformParamsOf(JSON.parse(JSON.stringify(p)) as Record<string, unknown>)).toEqual(p);
  });

  it("round-trips an accepted time-unit pair; rejects a malformed one", () => {
    const p: SimsParams = {
      op: "sims",
      calibration: { method: "rate", sputterRate: 1, rateUnit: "nm/s", depthUnit: "nm", timeUnit: "s", acceptedTimeUnit: ["", "s"] },
    };
    expect(simsParamsOf(JSON.parse(JSON.stringify(p)) as Record<string, unknown>)).toEqual(p);
    expect(() =>
      simsParamsOf({ op: "sims", calibration: { method: "rate", sputterRate: 1, depthUnit: "nm", acceptedTimeUnit: true } }),
    ).toThrow("acceptedTimeUnit");
    expect(() =>
      simsParamsOf({ op: "sims", calibration: { method: "rate", sputterRate: 1, depthUnit: "nm", acceptedTimeUnit: ["s"] } }),
    ).toThrow("acceptedTimeUnit");
  });

  it.each([
    [{}, "at least one stage"],
    [{ calibration: { method: "magic" } }, 'unknown SIMS calibration "magic"'],
    [{ calibration: { method: "rate" } }, "sputterRate"],
    [{ calibration: { method: "crater" } }, "craterDepth"],
    [{ background: { lo: 1 } }, '"lo" and "hi"'],
    [{ normalization: { reference: "" } }, "reference column name"],
    [{ normalization: { reference: "Si", rsf: { B: -1 } } }, "positive"],
    [{ smoothing: { method: "median", window: 2 } }, 'unknown SIMS smoothing "median"'],
    [{ smoothing: { method: "moving", window: 0 } }, "integer ≥ 1"],
    [{ background: "all" }, "must be an object"],
    [{ background: { lo: 1, hi: 2, keep: [3] } }, "list column names"],
  ])("refuses %j", (raw, msg) => {
    expect(() => simsParamsOf({ op: "sims", ...raw })).toThrow(msg);
  });
});

describe("computeSims + runTransform", () => {
  it("stamps the source id and name for the Library's derived mark", async () => {
    const r = await computeSims(NORM, { id: "p1", name: "run1.csv", data: profile });
    expect(r.data.metadata.sims_source).toEqual({ id: "p1", name: "run1.csv" });
    expect(r.name).toBe("run1 (SIMS processed)");
    expect(r.warnings[0]).toMatchObject({ code: "non-positive", info: true });
  });

  it("creates one undoable, recorded dataset and replays by column NAME onto a swapped file", async () => {
    const out = await runTransform(useApp.getState, NORM, "p1");
    const s = useApp.getState();
    const made = s.datasets.find((d) => d.id === out?.id);
    expect(made?.data.values.map((r) => r[0])).toEqual([0.01, 0.02, 0.01]);
    expect(made?.data.metadata).toMatchObject({ worksheet_transform: "sims", sims_source: { id: "p1" } });
    const [step] = s.macroSteps;
    expect(step).toMatchObject({ kind: "transform", label: "SIMS run1.csv: ÷ Si" });
    expect(step.params).toMatchObject({ op: "sims", normalization: { reference: "Si" }, input: { id: "p1" }, inputIsTarget: true });
    expect(transformStepText(NORM, "run1.csv").code).toContain('qz.transform("sims"');

    // Replay the recorded step onto the second file: Si is column 0 there.
    const replayed = await runTransform(useApp.getState, transformParamsOf(step.params as Record<string, unknown>), "p2");
    const body = vi.mocked(processSims).mock.calls[1][0];
    expect(body.normalization?.reference).toBe(0);
    const second = useApp.getState().datasets.find((d) => d.id === replayed?.id);
    expect(second?.data.values.map((r) => r[1])).toEqual([0.02, 0.01, 0.01]);

    act(() => useApp.getState().undo());
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["p1", "p2"]);
  });

  it("the derived dataset and its recipe survive a .dwk round trip", async () => {
    const out = await runTransform(useApp.getState, NORM, "p1");
    const s = useApp.getState();
    const text = serializeWorkspace({ datasets: s.datasets, macroSteps: s.macroSteps });
    const back = parseWorkspace(text);
    const made = back.datasets.find((d) => d.id === out?.id);
    expect(made?.data.metadata).toMatchObject({
      sims_source: { id: "p1", name: "run1.csv" },
      sims_processing: [{ stage: "normalization", reference: "Si" }],
    });
    const step = back.macroSteps?.find((st) => st.kind === "transform");
    expect(transformParamsOf(step?.params as Record<string, unknown>)).toEqual(NORM);
  });

  it("a BLANK sample (JSON null off the wire) is stored as NaN, so the .dwk still reopens (slice 2)", async () => {
    // The route writes NaN as null; a null cell is refused by the .dwk
    // reader, which used to make a saved workspace holding a SIMS output with
    // any blank (a non-positive reference, a union-grid gap) unopenable.
    vi.mocked(processSims).mockImplementationOnce(async (body) => {
      const r = await fakeBackend(body);
      return { ...r, dataset: { ...r.dataset, values: [[null as unknown as number, 1000], [0.02, 1000], [0.01, 500]] } };
    });
    const out = await runTransform(useApp.getState, NORM, "p1");
    const made = useApp.getState().datasets.find((d) => d.id === out?.id);
    expect(Number.isNaN(made?.data.values[0][0])).toBe(true);
    const back = parseWorkspace(serializeWorkspace({ datasets: useApp.getState().datasets }));
    expect(Number.isNaN(back.datasets.find((d) => d.id === out?.id)?.data.values[0][0])).toBe(true);
  });
});
