// BUG-017 regression suite: a dataset holding a NaN, ±Infinity or -0 cell must
// survive every JSON round trip the app puts it through.
//
// Before the fix, `JSON.stringify` wrote all three non-finite values as `null`
// and `-0` as `0`; `lib/workspaceDatasetParse.ts` rejected the `null`s and
// threw `dataset N ("name") has an invalid data structure`, and because
// `parseWorkspace` maps datasets with no per-entry recovery, ONE such cell made
// the WHOLE workspace unopenable. The NaN is not exotic: `store/cellEdit.ts`'s
// `insertRows` mints `Number.NaN` in every cell of a blank inserted row, which
// is why the first test here reaches it through that action rather than by
// writing a NaN into a fixture by hand.

import { beforeEach, describe, expect, it } from "vitest";

import {
  autosaveHealth,
  loadAutosave,
  saveAutosave,
  setAutosaveBackend,
} from "./autosave";
import { memoryBackend } from "./autosaveBackend";
import { resetBookTransportForTests } from "./bookData";
import {
  decodeCell,
  encodeCell,
  encodeCells,
  encodeDataStruct,
  encodeDatasetCells,
  isWireCellArray,
} from "./nonFiniteCells";
import type { PeakTable } from "./peakTable";
import { peakDataFingerprint, peakTableMatchesData } from "./peakTableFit";
import type { Dataset, DataStruct } from "./types";
import { buildTransferPackage, parseTransferPackage } from "./workbookTransfer";
import { parseWorkspace, serializeWorkspace, type WorkspaceState } from "./workspace";
import { useApp } from "../store/useApp";

const finiteData = (): DataStruct => ({
  time: [0, 1, 2],
  values: [
    [10, 100],
    [20, 200],
    [30, 300],
  ],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
});

const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d1",
  name: "scan.dat",
  data: finiteData(),
  ...over,
});

const ws = (datasets: Dataset[]): WorkspaceState => ({ datasets } as WorkspaceState);

/** What a real Save/Open does: serialize, write the text out, read it back,
 *  parse. The extra `JSON.parse`/`JSON.stringify` hop is not decoration — it
 *  is exactly what `store/packProjectContent.ts`'s `contentFingerprint` does
 *  to the same text, so it pins that the sentinels survive a re-encode too. */
function roundTrip(state: WorkspaceState) {
  const onDisk = serializeWorkspace(state);
  return parseWorkspace(JSON.stringify(JSON.parse(onDisk)));
}

/** The PRE-FIX cell predicate, copied verbatim from the `isNumberArray` this
 *  commit replaced. Used to demonstrate what an OLD build (which cannot be
 *  changed) does when handed a new `.dwk` — see the "old build" test. */
const preFixIsNumberArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === "number");

beforeEach(() => {
  resetBookTransportForTests();
  localStorage.clear();
  setAutosaveBackend(memoryBackend());
  useApp.setState({ datasets: [ds()], activeId: "d1" });
});

describe("encoder/decoder unit contract", () => {
  it("maps exactly the four values JSON cannot represent, and nothing else", () => {
    expect(encodeCell(Number.NaN)).toBe("NaN");
    expect(encodeCell(Infinity)).toBe("Infinity");
    expect(encodeCell(-Infinity)).toBe("-Infinity");
    expect(encodeCell(-0)).toBe("-0");
    expect(encodeCell(0)).toBe(0);
    expect(encodeCell(-1.5)).toBe(-1.5);
  });

  it("decodes each sentinel back to the exact same value, -0 included", () => {
    expect(decodeCell("NaN")).toBeNaN();
    expect(decodeCell("Infinity")).toBe(Infinity);
    expect(decodeCell("-Infinity")).toBe(-Infinity);
    expect(Object.is(decodeCell("-0"), -0)).toBe(true);
    expect(decodeCell(7)).toBe(7);
  });

  it("accepts a number or the four sentinels, and rejects null and other strings", () => {
    expect(isWireCellArray([1, "NaN", "Infinity", "-Infinity", "-0"])).toBe(true);
    expect(isWireCellArray([1, null, 3])).toBe(false);
    expect(isWireCellArray([1, "nan", 3])).toBe(false);
    expect(isWireCellArray([1, "0", 3])).toBe(false);
    expect(isWireCellArray("not an array")).toBe(false);
  });
});

describe("no output change for ordinary data (no schema bump)", () => {
  // The MECHANISM behind "a .dwk of finite data serializes byte-for-byte as it
  // did before": the encoders hand back the INPUT object, so the graph
  // JSON.stringify walks is literally the same one it walked pre-fix.
  it("returns the input array/struct/dataset by reference when nothing needs a sentinel", () => {
    const row = [1, 2, 3];
    expect(encodeCells(row)).toBe(row);
    const data = finiteData();
    expect(encodeDataStruct(data)).toBe(data);
    const dataset = ds({ data, raw: data });
    expect(encodeDatasetCells(dataset)).toBe(dataset);
  });

  it("writes a finite dataset's payload with the exact bytes it had before", () => {
    const original = finiteData();
    const doc = JSON.parse(serializeWorkspace(ws([ds({ data: original })])));
    expect(JSON.stringify(doc.datasets[0].data)).toBe(JSON.stringify(original));
    expect(serializeWorkspace(ws([ds()]))).not.toContain('"NaN"');
  });
});

describe("a NaN cell minted by the app's own insertRows survives Save → Open", () => {
  it("reopens the workspace instead of throwing, with the blank row still NaN", () => {
    useApp.getState().insertRows("d1", 1, 1);
    const inserted = useApp.getState().datasets[0];
    expect(inserted.data.time[1]).toBeNaN();
    expect(inserted.data.values[1][0]).toBeNaN();

    const loaded = roundTrip(ws([inserted]));

    expect(loaded.datasets).toHaveLength(1);
    expect(loaded.datasets[0].data.time[1]).toBeNaN();
    expect(loaded.datasets[0].data.values[1]).toHaveLength(2);
    expect(loaded.datasets[0].data.values[1][0]).toBeNaN();
    expect(loaded.datasets[0].data.values[1][1]).toBeNaN();
    // The rows around it are untouched.
    expect(loaded.datasets[0].data.time[0]).toBe(0);
    expect(loaded.datasets[0].data.values[2]).toEqual([20, 200]);
  });

  it("does not take the OTHER datasets in the same workspace down with it", () => {
    useApp.getState().insertRows("d1", 0, 1);
    const withNaN = useApp.getState().datasets[0];
    const healthy = ds({ id: "d2", name: "other.dat" });

    const loaded = roundTrip(ws([withNaN, healthy]));

    expect(loaded.datasets.map((d) => d.name)).toEqual(["scan.dat", "other.dat"]);
  });
});

describe("±Infinity and -0 cells", () => {
  it("round-trips +Infinity and -Infinity with their signs", () => {
    const data = finiteData();
    data.values[0][0] = Infinity;
    data.values[1][1] = -Infinity;
    data.time[2] = Infinity;

    const loaded = roundTrip(ws([ds({ data })]));

    expect(loaded.datasets[0].data.values[0][0]).toBe(Infinity);
    expect(loaded.datasets[0].data.values[1][1]).toBe(-Infinity);
    expect(loaded.datasets[0].data.time[2]).toBe(Infinity);
  });

  it("round-trips -0 as -0, not +0", () => {
    const data = finiteData();
    data.values[0][0] = -0;
    data.time[1] = -0;

    const loaded = roundTrip(ws([ds({ data })]));

    expect(Object.is(loaded.datasets[0].data.values[0][0], -0)).toBe(true);
    expect(Object.is(loaded.datasets[0].data.time[1], -0)).toBe(true);
    // +0 must stay +0 — the branch is a sign test, not a "zero" test.
    expect(Object.is(loaded.datasets[0].data.values[1][0], -0)).toBe(false);
  });

  it("carries the same encoding through a dataset's base-only `raw`", () => {
    const data = finiteData();
    const raw = finiteData();
    raw.values[2][0] = Number.NaN;
    raw.time[0] = -0;

    const loaded = roundTrip(ws([ds({ data, raw })]));

    expect(loaded.datasets[0].raw?.values[2][0]).toBeNaN();
    expect(Object.is(loaded.datasets[0].raw?.time[0], -0)).toBe(true);
  });
});

describe("compatibility in both directions", () => {
  it("parses a pre-fix .dwk (plain numbers, no sentinels) exactly as before", () => {
    const legacy = JSON.stringify({
      format: "quantized-workspace",
      version: 1,
      datasets: [{ id: "d1", name: "scan.dat", data: finiteData() }],
    });

    const loaded = parseWorkspace(legacy);

    expect(loaded.datasets[0].data.time).toEqual([0, 1, 2]);
    expect(loaded.datasets[0].data.values).toEqual([
      [10, 100],
      [20, 200],
      [30, 300],
    ]);
  });

  it("still REFUSES a pre-fix null cell rather than guessing which value it was", () => {
    // Deliberate (see parseWorkspaceDataset's doc): `null` meant NaN, +Infinity
    // OR -Infinity in a pre-fix save and is also what corrupt input looks like,
    // so it stays a hard rejection instead of being silently read as NaN.
    const lossy = JSON.stringify({
      format: "quantized-workspace",
      version: 1,
      datasets: [
        {
          id: "d1",
          name: "scan.dat",
          data: { ...finiteData(), values: [[10, null], [20, 200], [30, 300]] },
        },
      ],
    });

    expect(() => parseWorkspace(lossy)).toThrow(
      'dataset 0 ("scan.dat") has an invalid data structure',
    );
  });

  it("makes an OLD build refuse a sentinel-bearing .dwk loudly instead of corrupting it", () => {
    // An old build cannot be changed, so this pins what it DOES: its
    // `isNumberArray` (copied verbatim above) fails on a sentinel string, so
    // `isDataStruct` fails and it throws its usual clear per-dataset error —
    // it can never read "NaN" as a number or silently substitute one.
    const data = finiteData();
    data.values[0][0] = Number.NaN;
    const doc = JSON.parse(serializeWorkspace(ws([ds({ data })])));

    expect(doc.datasets[0].data.values[0][0]).toBe("NaN");
    expect(preFixIsNumberArray(doc.datasets[0].data.values[0])).toBe(false);
  });
});

describe("autosave (lib/autosave.ts localStorage/memory snapshots)", () => {
  it("restores a NaN/-0 dataset from an autosave generation", async () => {
    useApp.getState().insertRows("d1", 1, 1);
    const inserted = useApp.getState().datasets[0];
    inserted.data.values[0][1] = -0;

    expect(await saveAutosave(ws([inserted]))).toBe(true);
    expect(autosaveHealth().error).toBeNull();
    const restored = await loadAutosave();

    expect(restored?.datasets).toHaveLength(1);
    expect(restored?.datasets[0].data.values[1][0]).toBeNaN();
    expect(Object.is(restored?.datasets[0].data.values[0][1], -0)).toBe(true);
  });

  it("counts a NaN-bearing snapshot as RESTORABLE (it used to parse as junk)", async () => {
    // `isRestorable` in autosave.ts gates a generation on `parseWorkspace`
    // succeeding — a pre-fix snapshot of this workspace failed that check, so
    // crash recovery silently skipped it and offered an older generation.
    useApp.getState().insertRows("d1", 0, 2);
    await saveAutosave(ws([useApp.getState().datasets[0]]));

    expect((await loadAutosave())?.datasets[0].name).toBe("scan.dat");
  });
});

describe("workbook Copy/Paste transfer package", () => {
  it("round-trips a NaN cell through build → parse instead of refusing the workbook", () => {
    const data = finiteData();
    data.values[1][0] = Number.NaN;
    data.time[0] = -Infinity;
    const member = ds({ data, workbookId: "wb1" });
    const state = {
      workbooks: [{ id: "wb1", name: "book", kind: "origin" as const }],
      datasets: [member],
      editableFigures: [],
      reports: [],
      quickPlotTemplates: [],
    };

    const built = buildTransferPackage("wb1", state as never);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = parseTransferPackage(built.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.pkg.datasets[0].data.values[1][0]).toBeNaN();
    expect(parsed.pkg.datasets[0].data.time[0]).toBe(-Infinity);
  });

  // Regression: `encodeDatasetCells` (the function this package's build step
  // maps over every member dataset) encodes `data` AND `raw` — but unlike
  // `serializeWorkspace`'s `.dwk` path, which calls `encodeDataStruct` on
  // `data`/`raw` separately and inline, this is the ONE call site that could
  // silently ignore `raw` and still leave every OTHER spec in this file
  // green (sabotage-verified: see the BUG-017 entry). A dropped-then-decoded
  // `raw` fails `isWireDataStruct` on the way back in and is fail-closed
  // (workspaceDatasetParse.ts drops it with no error, per that module's
  // doc), so the failure mode is silent data loss, not a throw — this test
  // exists specifically to keep that branch guarded.
  it("carries the same encoding through a dataset's base-only `raw`", () => {
    const data = finiteData();
    const raw = finiteData();
    raw.values[2][0] = Number.NaN;
    raw.time[0] = -0;
    const member = ds({ data, raw, workbookId: "wb1" });
    const state = {
      workbooks: [{ id: "wb1", name: "book", kind: "origin" as const }],
      datasets: [member],
      editableFigures: [],
      reports: [],
      quickPlotTemplates: [],
    };

    const built = buildTransferPackage("wb1", state as never);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = parseTransferPackage(built.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.pkg.datasets[0].raw?.values[2][0]).toBeNaN();
    expect(Object.is(parsed.pkg.datasets[0].raw?.time[0], -0)).toBe(true);
  });
});

describe("peak-table fingerprint survives the -0 round trip", () => {
  it("keeps a saved fit attached after reopen (it was discarded before the fix)", () => {
    const data = finiteData();
    data.values[0][0] = -0;
    const dataset = ds({ data });
    const table: PeakTable = {
      version: 1,
      peaks: [
        {
          id: "p1",
          center: 28.4,
          centerErr: null,
          fwhm: 0.2,
          fwhmErr: null,
          height: 100,
          heightErr: null,
          area: 21,
          bg: 0,
          eta: null,
          model: "pseudovoigt",
          status: "ok",
          excluded: false,
        },
      ],
      provenance: {
        datasetId: "d1",
        datasetName: "scan.dat",
        method: "simultaneous",
        model: "pseudovoigt",
        bgDegree: 1,
        linkMode: "none",
        constrain: false,
        bgCoeffs: [0, 0],
        R2: 0.99,
        rmse: 0.1,
        wavelengthA: 1.5406,
        xLabel: "2theta",
        xUnit: "deg",
        fingerprint: peakDataFingerprint(dataset),
        fittedAt: "2026-09-16T00:00:00.000Z",
      },
    };

    const loaded = roundTrip(ws([{ ...dataset, peakTable: table }]));
    const reopened = loaded.datasets[0];

    expect(reopened.peakTable).toBeTruthy();
    expect(Object.is(reopened.data.values[0][0], -0)).toBe(true);
    expect(peakDataFingerprint(reopened)).toBe(table.provenance.fingerprint);
    expect(reopened.peakTable && peakTableMatchesData(reopened.peakTable, reopened)).toBe(true);
  });
});
