import { beforeEach, describe, expect, it } from "vitest";

import type { MultiFitResult } from "../lib/peakTable";
import { includedPeaks, peakDataFingerprint, peakTableMatchesData } from "../lib/peakTableFit";
import type { DataStruct } from "../lib/types";
import { editPeak, publishFitResult, publishPeakTable, removePeaks, setPeakExcluded } from "./peakTables";
import { useApp } from "./useApp";

const data = (metadata: Record<string, unknown> = {}): DataStruct => ({
  time: [0, 1, 2],
  values: [[1], [9], [2]],
  labels: ["I"],
  units: ["cps"],
  metadata,
});

const RESULT: MultiFitResult = {
  peaks: [
    { center: 30.1, fwhm: 0.2, height: 100, bg: 5, eta: null, area: 21, status: "fitted(global)", model: "Gaussian" },
    { center: 43.2, fwhm: 0.25, height: 80, bg: 5, eta: null, area: 19, status: "fitted(global)", model: "Gaussian" },
  ],
  bgCoeffs: [5, 0],
  R2: 0.99,
  rmse: 0.5,
  nPeaks: 2,
  model: "Gaussian",
};

const OPTS = { bgDegree: 1, linkMode: "None", constrain: false, xKey: null };

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "film.xrdml", data: data({ wavelength_a: 1.5406 }) }],
    activeId: "d1",
    history: [],
    future: [],
  });
});

describe("publishFitResult", () => {
  it("attaches a durable table to the source dataset, with its instrument wavelength", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const t = useApp.getState().datasets[0].peakTable;
    expect(t?.peaks.map((p) => p.center)).toEqual([30.1, 43.2]);
    expect(t?.provenance.datasetId).toBe("d1");
    expect(t?.provenance.datasetName).toBe("film.xrdml");
    expect(t?.provenance.method).toBe("simultaneous");
    expect(t?.provenance.wavelengthA).toBe(1.5406);
  });

  it("records a null wavelength when the file carried no instrument metadata", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "plain.dat", data: data() }], activeId: "d1" });
    publishFitResult("d1", RESULT, "independent", OPTS);
    expect(useApp.getState().datasets[0].peakTable?.provenance.wavelengthA).toBeNull();
    expect(useApp.getState().datasets[0].peakTable?.provenance.method).toBe("independent");
  });

  it("re-fitting keeps the exclusions the user set on the previous table", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const first = useApp.getState().datasets[0].peakTable;
    setPeakExcluded("d1", first!.peaks[1].id, true);
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const second = useApp.getState().datasets[0].peakTable;
    expect(second!.peaks.map((p) => p.excluded)).toEqual([false, true]);
    expect(second!.peaks[1].id).not.toBe(first!.peaks[1].id);
  });

  it("is a no-op for an unknown dataset id (removed mid-fit)", () => {
    publishFitResult("gone", RESULT, "simultaneous", OPTS);
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("only touches the source dataset", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: data() },
        { id: "d2", name: "b", data: data() },
      ],
      activeId: "d1",
    });
    publishFitResult("d2", RESULT, "simultaneous", OPTS);
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    expect(useApp.getState().datasets[1].peakTable).toBeDefined();
  });
});

describe("setPeakExcluded", () => {
  it("excludes exactly the addressed peak, and consumers then skip it", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const t = useApp.getState().datasets[0].peakTable!;
    setPeakExcluded("d1", t.peaks[0].id, true);
    const after = useApp.getState().datasets[0].peakTable!;
    expect(after.peaks.map((p) => p.excluded)).toEqual([true, false]);
    expect(includedPeaks(after).map((p) => p.center)).toEqual([43.2]);
  });

  it("writes NOTHING when the id is unknown or the dataset has no table", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const before = useApp.getState().datasets;
    setPeakExcluded("d1", "no-such-peak", true);
    expect(useApp.getState().datasets).toBe(before); // same array reference: no re-render
    setPeakExcluded("gone", "whatever", true);
    expect(useApp.getState().datasets).toBe(before);
  });
});

describe("publishPeakTable", () => {
  it("replaces an existing table wholesale", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const t = useApp.getState().datasets[0].peakTable!;
    publishPeakTable("d1", { ...t, peaks: [t.peaks[0]] });
    expect(useApp.getState().datasets[0].peakTable?.peaks).toHaveLength(1);
  });
});

describe("publishFitResult — the round-2 provenance (data fingerprint + x axis)", () => {
  it("stamps a fingerprint of the LIVE data, so the table can be told stale later", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const ds = useApp.getState().datasets[0];
    expect(ds.peakTable?.provenance.fingerprint).toBe(peakDataFingerprint(ds));
    expect(peakTableMatchesData(ds.peakTable!, ds)).toBe(true);
    // Edit one measured value and the SAME table no longer describes it.
    expect(peakTableMatchesData(ds.peakTable!, { ...ds, data: { ...ds.data, values: [[1], [500], [2]] } })).toBe(
      false,
    );
    // Round 3: excluding a row moves the fit's real input (the analysis view)
    // without touching `ds.data` at all — the digest must see that too.
    expect(peakTableMatchesData(ds.peakTable!, { ...ds, excludedRows: [1] })).toBe(false);
  });

  it("names the x axis from the time column's Origin metadata when nothing is plotted", () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "film.xrdml",
          data: data({ x_column_long: "2Theta", x_column_unit: "deg" }),
        },
      ],
      activeId: "d1",
    });
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const prov = useApp.getState().datasets[0].peakTable!.provenance;
    expect(prov.xLabel).toBe("2Theta");
    expect(prov.xUnit).toBe("deg");
  });

  it("names the x axis from the PLOTTED column when one is chosen", () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "rsm.xrdml",
          data: { ...data(), labels: ["q"], units: ["1/A"] },
        },
      ],
      activeId: "d1",
    });
    publishFitResult("d1", RESULT, "simultaneous", { ...OPTS, xKey: 0 });
    const prov = useApp.getState().datasets[0].peakTable!.provenance;
    expect(prov.xLabel).toBe("q");
    expect(prov.xUnit).toBe("1/A");
  });
});


describe("manual durable peak edits", () => {
  it("edits by stable id, clears affected uncertainty/global metrics, and keeps raw data untouched", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const before = useApp.getState().datasets[0];
    const id = before.peakTable!.peaks[0].id;
    const next = editPeak("d1", id, { center: 30.25, fwhm: 0.22, height: 95, area: 20 });
    expect(next?.peaks[0]).toEqual(expect.objectContaining({
      id,
      center: 30.25,
      fwhm: 0.22,
      height: 95,
      area: 20,
      status: "manual-edit",
      centerErr: null,
      fwhmErr: null,
      heightErr: null,
    }));
    expect(next?.provenance.R2).toBeNull();
    expect(next?.provenance.rmse).toBeNull();
    expect(useApp.getState().datasets[0].data).toBe(before.data);
    expect(next?.provenance.fingerprint).toBe(before.peakTable!.provenance.fingerprint);
  });

  it("removes addressed peaks and removes the artifact entirely when the last row is deleted", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const table = useApp.getState().datasets[0].peakTable!;
    const one = removePeaks("d1", new Set([table.peaks[0].id]));
    expect(one?.peaks).toHaveLength(1);
    expect(one?.peaks[0].id).toBe(table.peaks[1].id);
    expect(one?.provenance.R2).toBeNull();

    removePeaks("d1", new Set([table.peaks[1].id]));
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("undoes and redoes a manual edit as one effective-change-only step", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const original = useApp.getState().datasets[0].peakTable!;
    const id = original.peaks[0].id;

    editPeak("d1", id, { center: original.peaks[0].center });
    expect(useApp.getState().history).toHaveLength(0);
    editPeak("d1", id, { center: 31.5 });
    expect(useApp.getState().history.map((entry) => entry.label)).toEqual(["edit fitted peak"]);
    expect(useApp.getState().datasets[0].peakTable?.peaks[0].center).toBe(31.5);

    useApp.getState().undo();
    expect(useApp.getState().datasets[0].peakTable).toEqual(original);
    useApp.getState().redo();
    expect(useApp.getState().datasets[0].peakTable?.peaks[0].center).toBe(31.5);
  });

  it("undoes partial and final-row removals without recording no-op removals", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const original = useApp.getState().datasets[0].peakTable!;

    removePeaks("d1", new Set(["missing"]));
    expect(useApp.getState().history).toHaveLength(0);
    removePeaks("d1", new Set([original.peaks[0].id]));
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().datasets[0].peakTable?.peaks).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].peakTable).toEqual(original);

    removePeaks("d1", new Set(original.peaks.map((peak) => peak.id)));
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].peakTable).toEqual(original);
    useApp.getState().redo();
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });
});

describe("manual edit consistency and validation (review round 2)", () => {
  function withErrs(): string {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const t = useApp.getState().datasets[0].peakTable!;
    // Every current producer writes null uncertainties; give them values so
    // the per-field clearing below is actually observable.
    publishPeakTable("d1", {
      ...t,
      peaks: t.peaks.map((p) => ({ ...p, centerErr: 0.01, fwhmErr: 0.02, heightErr: 3 })),
    });
    useApp.setState({ history: [], future: [] });
    return t.peaks[0].id;
  }

  it("clears only the uncertainty of each field that changed", () => {
    const id = withErrs();
    const p = useApp.getState().datasets[0].peakTable!.peaks[0];
    const next = editPeak("d1", id, { center: p.center, fwhm: p.fwhm, height: p.height, area: 25 });
    expect(next?.peaks[0]).toEqual(expect.objectContaining({
      area: 25, centerErr: 0.01, fwhmErr: 0.02, heightErr: 3,
    }));
    const moved = editPeak("d1", id, { center: 30.4, fwhm: p.fwhm, height: p.height, area: 25 });
    expect(moved?.peaks[0]).toEqual(expect.objectContaining({
      centerErr: null, fwhmErr: 0.02, heightErr: 3,
    }));
  });

  it("rescales an untouched area when height or FWHM changes, keeping the shape", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const p = useApp.getState().datasets[0].peakTable!.peaks[0]; // h 100, w 0.2, area 21
    const next = editPeak("d1", p.id, { center: p.center, fwhm: 0.4, height: 50, area: p.area });
    expect(next?.peaks[0].area).toBeCloseTo(21 * (50 / 100) * (0.4 / 0.2));
  });

  it("keeps an area the user typed explicitly", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const p = useApp.getState().datasets[0].peakTable!.peaks[0];
    const next = editPeak("d1", p.id, { center: p.center, fwhm: 0.4, height: 50, area: 7 });
    expect(next?.peaks[0].area).toBe(7);
  });

  it.each([
    [{ fwhm: 0 }],
    [{ height: -1 }],
    [{ area: 0 }],
    [{ center: Number.NaN }],
  ])("refuses a non-physical edit %o without writing or recording history", (patch) => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const before = useApp.getState().datasets[0].peakTable!;
    expect(editPeak("d1", before.peaks[0].id, patch)).toBe(before);
    expect(useApp.getState().datasets[0].peakTable).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("records exclusion toggles so undo steps back through edits and exclusions in order", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const [a, b] = useApp.getState().datasets[0].peakTable!.peaks;
    editPeak("d1", a.id, { center: 30.4 });
    setPeakExcluded("d1", b.id, true);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["edit fitted peak", "exclude fitted peak"]);

    useApp.getState().undo(); // the exclusion only
    let t = useApp.getState().datasets[0].peakTable!;
    expect(t.peaks[1].excluded).toBe(false);
    expect(t.peaks[0].center).toBe(30.4);

    useApp.getState().undo(); // then the edit
    t = useApp.getState().datasets[0].peakTable!;
    expect(t.peaks[0].center).toBe(30.1);
  });

  it("records one history step for a multi-row removal", () => {
    publishFitResult("d1", RESULT, "simultaneous", OPTS);
    const ids = new Set(useApp.getState().datasets[0].peakTable!.peaks.map((p) => p.id));
    removePeaks("d1", ids);
    expect(useApp.getState().history).toHaveLength(1);
  });
});
