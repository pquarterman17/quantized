import { beforeEach, describe, expect, it } from "vitest";

import type { MultiFitResult } from "../lib/peakTable";
import { includedPeaks } from "../lib/peakTableFit";
import type { DataStruct } from "../lib/types";
import { publishFitResult, publishPeakTable, setPeakExcluded } from "./peakTables";
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

const OPTS = { bgDegree: 1, linkMode: "None", constrain: false };

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "film.xrdml", data: data({ wavelength_a: 1.5406 }) }],
    activeId: "d1",
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
