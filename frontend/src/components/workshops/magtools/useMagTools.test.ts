import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  convertMagUnits,
  subtractHysteresisBackground,
  subtractMagBackground,
} from "../../../lib/api/magnetometry";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMagTools } from "./useMagTools";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
  convertMagUnits: vi.fn(),
}));

const mvt: DataStruct = {
  time: [2, 100, 300], // temperature
  values: [[5], [2], [1]], // moment (emu)
  labels: ["Moment"],
  units: ["emu"],
  metadata: { x_column_name: "Temperature", x_column_unit: "K" },
};

/** The reported shape: an M(H) loop, x = Magnetic Field in Oe. */
const mvh: DataStruct = {
  time: [-15000, 0, 15000],
  values: [[-1], [0], [1]],
  labels: ["Moment"],
  units: ["emu"],
  metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
};

function load(data: DataStruct, name = "mt.dat"): void {
  useApp.setState({
    datasets: [{ id: "d1", name, data }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    status: "",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  load(mvt);
});

describe("useMagTools background — M(T)", () => {
  it("subtracts the high-T background into a new dataset", async () => {
    vi.mocked(subtractMagBackground).mockResolvedValue({
      corrected: [4, 1, 0],
      slope: -0.01,
      intercept: 3,
    });
    const { result } = renderHook(() => useMagTools());
    expect(result.current.bgPath).toBe("mt");

    await act(async () => {
      await result.current.subtractBackground();
    });

    expect(subtractMagBackground).toHaveBeenCalledWith({
      temperature: [2, 100, 300],
      moment: [5, 2, 1],
      auto_fraction: 0.1,
    });
    expect(subtractHysteresisBackground).not.toHaveBeenCalled();
    expect(result.current.fit).toEqual({ kind: "mt", slope: -0.01, intercept: 3 });
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    expect(ds[1].name).toBe("mt (bg-sub)");
    expect(ds[1].data.values).toEqual([[4], [1], [0]]);
  });

  it("uses the plotted T (X) and moment (primary Y) on multi-column data (audit P1 #1)", async () => {
    const multi: DataStruct = {
      time: [0, 1, 2], // a timestamp — NOT the temperature
      values: [[2, 5], [100, 2], [300, 1]], // [Temperature, Moment]
      labels: ["Temperature", "Moment"],
      units: ["K", "emu"],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "mt.dat", data: multi }],
      activeId: "d1",
      xKey: 0, // Temperature
      yKeys: [1], // Moment
      seriesOrder: null,
      status: "",
    });
    vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [4, 1, 0], slope: -0.01, intercept: 3 });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(subtractMagBackground).toHaveBeenCalledWith({
      temperature: [2, 100, 300], // Temperature channel, NOT the timestamp
      moment: [5, 2, 1], // Moment channel, NOT values[0]=Temperature
      auto_fraction: 0.1,
    });
    const ds = useApp.getState().datasets;
    expect(ds[1].data.time).toEqual([2, 100, 300]); // output on the plotted T
    expect(ds[1].data.labels).toEqual(["Moment"]); // labelled from the plotted Y
  });

  it("surfaces an error and adds no dataset", async () => {
    vi.mocked(subtractMagBackground).mockRejectedValue(new Error("need more high-T points"));
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(result.current.error).toContain("high-T");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

// BUG-021 defect 3 — the scientific bug. `subtract_mag_background` is a
// ONE-SIDED high-T fit; on a saturated loop its intercept carries +Ms and the
// whole loop is sheared down by that much (measured: plateaus at 0 and -2*Ms,
// squareness a meaningless 1.0). The Background tab must dispatch instead.
describe("useMagTools background — M(H)", () => {
  beforeEach(() => load(mvh, "loop.dat"));

  it("routes an M(H) loop to the hysteresis endpoint, never the high-T one", async () => {
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1.2, 0, 1.2],
      slope: -3e-8,
      offset: 5e-5,
    });
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("field");
    expect(result.current.bgPath).toBe("mh");

    await act(async () => {
      await result.current.subtractBackground();
    });

    expect(subtractHysteresisBackground).toHaveBeenCalledWith({
      h: [-15000, 0, 15000],
      m: [-1, 0, 1],
      hi_fraction: 0.7, // the LOOP's default, not the M(T) 0.1
    });
    expect(subtractMagBackground).not.toHaveBeenCalled();
    // The third reported quantity is an OFFSET, not an intercept.
    expect(result.current.fit).toEqual({ kind: "mh", slope: -3e-8, offset: 5e-5 });
    const ds = useApp.getState().datasets;
    expect(ds[1].name).toBe("loop (loop bg-sub)");
    expect(ds[1].data.metadata.mag_hysteresis_bg_subtracted).toBe(true);
    expect(ds[1].data.metadata.mag_bg_subtracted).toBeUndefined();
  });

  it("never sends one path's default fraction to the other route", async () => {
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({ corrected: [0, 0, 0], slope: 0, offset: 0 });
    vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [0, 0, 0], slope: 0, intercept: 0 });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(vi.mocked(subtractHysteresisBackground).mock.calls[0][0].hi_fraction).toBe(0.7);

    act(() => result.current.setBgMode("mt"));
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(vi.mocked(subtractMagBackground).mock.calls[0][0].auto_fraction).toBe(0.1);
  });

  it("switching path discards the previous readout — an intercept never sits under a χ/offset label", async () => {
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({ corrected: [0, 0, 0], slope: 1, offset: 2 });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(result.current.fit).toEqual({ kind: "mh", slope: 1, offset: 2 });

    act(() => result.current.setBgMode("mt"));
    expect(result.current.fit).toBeNull();
  });

  it("an explicit M(T) override still reaches the high-T route", async () => {
    vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [0, 0, 0], slope: 1, intercept: 2 });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setBgMode("mt"));
    expect(result.current.bgPath).toBe("mt");
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(subtractMagBackground).toHaveBeenCalledTimes(1);
    expect(subtractHysteresisBackground).not.toHaveBeenCalled();
  });
});

// The Origin importer (`io/origin_project/opj.py`) puts the SHORT column name
// ("A", "B", … "H", … "T") in `x_column_name` and the human label in
// `x_column_long`. Reading the short name alone hands the detector a single
// letter, whose whole-word rule then fires — an M(T) curve on Origin column
// "B" or "H" would classify as FIELD and silently run the loop routine.
describe("useMagTools background — Origin short column names", () => {
  function loadOrigin(short: string, long: string, unit = ""): void {
    load(
      {
        ...mvt,
        metadata: { x_column_name: short, x_column_long: long, x_column_unit: unit },
      },
      "origin.opj",
    );
  }

  it("prefers x_column_long: an M(T) curve on Origin column B stays M(T)", () => {
    loadOrigin("B", "Temperature");
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("temperature");
    expect(result.current.bgPath).toBe("mt");
  });

  it("prefers x_column_long: an M(H) loop on Origin column T stays M(H)", () => {
    loadOrigin("T", "Magnetic Field");
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("field");
    expect(result.current.bgPath).toBe("mh");
  });

  it("Origin's unrecovered-x long name (\"Row\") fails closed", () => {
    loadOrigin("A", "Row");
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("unknown");
    expect(result.current.bgPath).toBeNull();
  });

  // `_label_for` falls back to the SHORT designation when Origin supplied no
  // Long Name, so `x_column_long` can itself be a bare letter. Reading the
  // long name first does not on its own keep that out of the detector.
  it.each([
    ["B", "an M(T) curve in Origin column B"],
    ["H", "an M(T) curve in Origin column H"],
    ["T", "an M(H) loop in Origin column T"],
  ])("a bare-letter long name (%s) fails closed, never dispatches — %s", (letter) => {
    loadOrigin(letter, letter); // no Long Name -> _label_for returns the letter
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("unknown");
    expect(result.current.bgPath).toBeNull();
  });

  it("a bare-letter long name WITH a real unit still dispatches", () => {
    loadOrigin("B", "B", "Oe");
    const { result } = renderHook(() => useMagTools());
    expect(result.current.bgPath).toBe("mh");

    loadOrigin("T", "T", "K");
    const { result: r2 } = renderHook(() => useMagTools());
    expect(r2.current.bgPath).toBe("mt");
  });

  it("falls back to x_column_name when there is no long name", () => {
    loadOrigin("Magnetic Field", "");
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("field");
  });

  it("a named x CHANNEL still uses that channel's own label/unit", () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "origin.opj",
          data: {
            time: [0, 1, 2],
            values: [[2, 5], [100, 2], [300, 1]],
            labels: ["Temperature", "Moment"],
            units: ["K", "emu"],
            // A misleading time-axis hint that must NOT be consulted here.
            metadata: { x_column_name: "H", x_column_long: "Magnetic Field" },
          },
        },
      ],
      activeId: "d1",
      xKey: 0,
      yKeys: [1],
      seriesOrder: null,
      status: "",
    });
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("temperature");
  });
});

describe("useMagTools background — a no-op is reported as a no-op", () => {
  it("says no background was found when the loop routine returns (m, 0, 0)", async () => {
    load(mvh, "loop.dat");
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1, 0, 1],
      slope: 0,
      offset: 0,
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(result.current.warning).toContain("No high-field background found");
    expect(useApp.getState().status).toContain("no high-field background found");
  });

  it("a gap notice and a no-op notice both survive — neither replaces the other", async () => {
    load(
      {
        ...mvh,
        time: [-15000, -7500, 0, 7500, 15000],
        values: [[-1], [Number.NaN], [0], [0.5], [1]],
      },
      "loop.dat",
    );
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1, 0, 0.5, 1],
      slope: 0,
      offset: 0,
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(result.current.warning).toContain("1 of 5 rows are gaps");
    expect(result.current.warning).toContain("No high-field background found");
  });
});

// A derived dataset's x is a bare `time` column, so the inherited
// `x_column_*` hints are all any later reader has to go on. When x came from
// a CHANNEL they described the SOURCE's original time column — a different
// quantity — so the panel could flip to "Cannot tell M(T) from M(H)" the
// instant its own output became active.
describe("useMagTools background — the output records its real x identity", () => {
  it("stamps the plotted CHANNEL's label/unit onto the corrected dataset", async () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "loop.dat",
          data: {
            time: [0, 1, 2], // a timestamp — NOT the field
            values: [[-15000, -1], [0, 0], [15000, 1]],
            labels: ["Magnetic Field", "Moment"],
            units: ["Oe", "emu"],
            // Hints describing the TIMESTAMP column, which must not be inherited.
            metadata: { x_column_name: "Time", x_column_long: "Elapsed Time", x_column_unit: "s" },
          },
        },
      ],
      activeId: "d1",
      xKey: 0,
      yKeys: [1],
      seriesOrder: null,
      status: "",
    });
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1, 0, 1],
      slope: 1,
      offset: 2,
    });
    const { result } = renderHook(() => useMagTools());
    expect(result.current.bgPath).toBe("mh");
    await act(async () => {
      await result.current.subtractBackground();
    });

    const out = useApp.getState().datasets[1].data;
    expect(out.metadata.x_column_name).toBe("Magnetic Field");
    expect(out.metadata.x_column_long).toBe("Magnetic Field");
    expect(out.metadata.x_column_unit).toBe("Oe");
    // And the derived dataset, now active, still classifies as a loop.
    expect(result.current.detection.kind).toBe("field");
    expect(result.current.bgPath).toBe("mh");
  });

  it("keeps the source's time-axis hints when x WAS the time column", async () => {
    load(mvh, "loop.dat");
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1, 0, 1],
      slope: 1,
      offset: 2,
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    const out = useApp.getState().datasets[1].data;
    expect(out.metadata.x_column_name).toBe("Magnetic Field");
    expect(out.metadata.x_column_unit).toBe("Oe");
  });
});

describe("useMagTools background — a minor loop is not claimed to be centred", () => {
  it("says 'not centred' when the routine removed a slope but no offset", async () => {
    load(mvh, "loop.dat");
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1, 0, 1],
      slope: -3e-8,
      offset: 0, // the one-sided (minor-loop) branch: slope only, no centring
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    const status = useApp.getState().status;
    expect(status).toContain("not centred");
    expect(status).not.toContain("re-centred");
  });

  it("still says 're-centred' when an offset was actually removed", async () => {
    load(mvh, "loop.dat");
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1, 0, 1],
      slope: -3e-8,
      offset: 5e-5,
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(useApp.getState().status).toContain("re-centred the loop");
  });
});

describe("useMagTools background — the readout belongs to its dataset", () => {
  it("selecting a different dataset clears the previous one's fit", async () => {
    load(mvt, "mt.dat");
    vi.mocked(subtractMagBackground).mockResolvedValue({
      corrected: [4, 1, 0],
      slope: -0.01,
      intercept: 3,
    });
    const { result, rerender } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(result.current.fit).toEqual({ kind: "mt", slope: -0.01, intercept: 3 });

    // Click a different dataset — a loop. The panel re-labels to M(H); the
    // M(T) intercept must not still be sitting there under it.
    act(() => {
      useApp.setState({
        datasets: [
          ...useApp.getState().datasets,
          { id: "d2", name: "loop.dat", data: mvh },
        ],
        activeId: "d2",
      });
    });
    rerender();
    expect(result.current.bgPath).toBe("mh");
    expect(result.current.fit).toBeNull();
  });
});

describe("useMagTools background — ambiguous data fails closed", () => {
  it("runs NOTHING and says why when the x axis cannot be identified", async () => {
    load({ ...mvh, metadata: { x_column_name: "col 1", x_column_unit: "" } }, "mystery.dat");
    const { result } = renderHook(() => useMagTools());
    expect(result.current.detection.kind).toBe("unknown");
    expect(result.current.bgPath).toBeNull();

    await act(async () => {
      await result.current.subtractBackground();
    });

    expect(subtractMagBackground).not.toHaveBeenCalled();
    expect(subtractHysteresisBackground).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(1); // no output dataset
    expect(result.current.error).toContain("Cannot tell M(T) from M(H)");
  });

  it("runs once the user picks the data type", async () => {
    load({ ...mvh, metadata: { x_column_name: "col 1", x_column_unit: "" } }, "mystery.dat");
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({ corrected: [0, 0, 0], slope: 0, offset: 0 });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setBgMode("mh"));
    expect(result.current.bgPath).toBe("mh");
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(subtractHysteresisBackground).toHaveBeenCalledTimes(1);
  });
});

// BUG-021 defect 2 — the 422 itself. The reported loop had gaps; a NaN
// stringifies to `null`, which pydantic `list[float]` rejects once per element.
describe("useMagTools background — gaps (NaN) in the series", () => {
  const gappy: DataStruct = {
    time: [-15000, -7500, 0, 7500, 15000],
    values: [[-1], [Number.NaN], [0], [0.5], [1]],
    labels: ["Moment"],
    units: ["emu"],
    metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
  };

  it("sends no null, and maps `corrected` back onto the ORIGINAL rows", async () => {
    load(gappy, "loop.dat");
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({
      corrected: [-1.1, 0.1, 0.6, 1.1],
      slope: 1,
      offset: 2,
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });

    const body = vi.mocked(subtractHysteresisBackground).mock.calls[0][0];
    expect(body.m).toEqual([-1, 0, 0.5, 1]); // the gap row is gone
    expect(body.h).toEqual([-15000, 0, 7500, 15000]); // and its x with it
    expect(JSON.stringify(body)).not.toContain("null"); // the 422 trigger

    const out = useApp.getState().datasets[1].data;
    expect(out.time).toEqual(gappy.time); // full-length, original x
    expect(out.values).toHaveLength(5);
    expect(out.values[0]).toEqual([-1.1]);
    expect(Number.isNaN(out.values[1][0])).toBe(true); // the gap is still a gap
    expect(out.values[2]).toEqual([0.1]);
    expect(out.values[3]).toEqual([0.6]);
    expect(out.values[4]).toEqual([1.1]);
    expect(result.current.warning).toContain("1 of 5 rows are gaps");
  });

  it("refuses before the request when too little finite data remains", async () => {
    load(
      {
        ...gappy,
        values: [[Number.NaN], [Number.NaN], [Number.NaN], [Number.NaN], [1]],
      },
      "loop.dat",
    );
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(subtractHysteresisBackground).not.toHaveBeenCalled();
    expect(result.current.error).toContain("1 of 5 rows");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

describe("useMagTools units", () => {
  it("converts field/moment and writes a dataset with the new units", async () => {
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [2e-4, 0.01, 0.03],
      y: [5, 2, 1],
      x_unit: "T",
      y_unit: "emu",
      warning: "",
    });
    const { result } = renderHook(() => useMagTools());

    act(() => result.current.setTab("units"));
    act(() => result.current.setUnits({ toField: "T" }));
    await act(async () => {
      await result.current.convert();
    });

    const body = vi.mocked(convertMagUnits).mock.calls[0][0];
    expect(body).toMatchObject({ from_field: "Oe", to_field: "T", from_moment: "emu" });
    const ds = useApp.getState().datasets;
    expect(ds[1].data.units).toEqual(["emu"]);
    expect(ds[1].data.metadata.x_column_unit).toBe("T");
    expect(ds[1].data.time).toEqual([2e-4, 0.01, 0.03]);
  });

  it("surfaces the backend warning (e.g. emu/g needs mass)", async () => {
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [2, 100, 300],
      y: [5, 2, 1],
      x_unit: "Oe",
      y_unit: "emu",
      warning: "Cannot convert moment to emu/g: sample mass is 0.",
    });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setTab("units"));
    act(() => result.current.setUnits({ toMoment: "emu/g" }));
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.warning).toContain("sample mass is 0");
  });

  // The Units tab must NOT pair the coordinates the way the fit path does: a
  // conversion is a scalar multiply per axis, so a finite field on a row whose
  // MOMENT is a gap has to survive with its own converted value.
  it("sends no null and KEEPS a good field value on a moment-gap row", async () => {
    load(
      {
        time: [0, 100, 200],
        values: [[5], [Number.NaN], [1]],
        labels: ["Moment"],
        units: ["emu"],
        metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
      },
      "loop.dat",
    );
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [0, 0.01, 0.02],
      y: [5, 0, 1],
      x_unit: "T",
      y_unit: "emu",
      warning: "",
    });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setTab("units"));
    await act(async () => {
      await result.current.convert();
    });
    const body = vi.mocked(convertMagUnits).mock.calls[0][0];
    expect(body.x).toEqual([0, 100, 200]); // every field row sent, none dropped
    expect(body.y).toEqual([5, 0, 1]); // the moment gap sent as a placeholder
    expect(JSON.stringify(body)).not.toContain("null");
    const out = useApp.getState().datasets[1].data;
    expect(out.time).toEqual([0, 0.01, 0.02]); // the good x SURVIVES its row
    expect(out.values[0]).toEqual([5]);
    expect(Number.isNaN(out.values[1][0])).toBe(true); // the moment gap stays a gap
    expect(out.values[2]).toEqual([1]);
  });

  it("keeps a moment whose FIELD is a gap, and drops only that row's x", async () => {
    load(
      {
        time: [0, Number.NaN, 200],
        values: [[5], [7], [1]],
        labels: ["Moment"],
        units: ["emu"],
        metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
      },
      "loop.dat",
    );
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [0, 0, 0.02],
      y: [5, 7, 1],
      x_unit: "T",
      y_unit: "emu",
      warning: "",
    });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setTab("units"));
    await act(async () => {
      await result.current.convert();
    });
    expect(vi.mocked(convertMagUnits).mock.calls[0][0].x).toEqual([0, 0, 200]);
    const out = useApp.getState().datasets[1].data;
    expect(Number.isNaN(out.time[1])).toBe(true);
    expect(out.values).toEqual([[5], [7], [1]]); // every moment kept
  });

  it("stamps x_column_long too, so the new precedence cannot read a stale one", async () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "loop.dat",
          data: {
            time: [0, 1],
            values: [[-15000, -1], [15000, 1]],
            labels: ["Magnetic Field", "Moment"],
            units: ["Oe", "emu"],
            metadata: { x_column_name: "Time", x_column_long: "Elapsed Time", x_column_unit: "s" },
          },
        },
      ],
      activeId: "d1",
      xKey: 0,
      yKeys: [1],
      seriesOrder: null,
      status: "",
    });
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [-1.5, 1.5],
      y: [-1, 1],
      x_unit: "T",
      y_unit: "emu",
      warning: "",
    });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setTab("units"));
    await act(async () => {
      await result.current.convert();
    });
    const out = useApp.getState().datasets[1].data;
    expect(out.metadata.x_column_long).toBe("Magnetic Field");
    expect(out.metadata.x_column_name).toBe("Magnetic Field");
    expect(out.metadata.x_column_unit).toBe("T"); // the CONVERTED unit
  });

  it("converts the good axis and WARNS when only one axis is all gaps", async () => {
    load(
      {
        time: [0, 100],
        values: [[Number.NaN], [Number.NaN]],
        labels: ["Moment"],
        units: ["emu"],
        metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
      },
      "loop.dat",
    );
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [0, 0.01],
      y: [0, 0],
      x_unit: "T",
      y_unit: "emu",
      warning: "",
    });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setTab("units"));
    await act(async () => {
      await result.current.convert();
    });
    expect(convertMagUnits).toHaveBeenCalledTimes(1); // not refused
    expect(result.current.warning).toContain("Every moment value is a gap");
    const out = useApp.getState().datasets[1].data;
    expect(out.time).toEqual([0, 0.01]); // the field still converted
    expect(out.values.every((r) => Number.isNaN(r[0]))).toBe(true);
  });

  it("refuses an all-gap series instead of minting an all-NaN dataset", async () => {
    load(
      {
        time: [Number.NaN, Number.NaN],
        values: [[Number.NaN], [Number.NaN]],
        labels: ["Moment"],
        units: ["emu"],
        metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
      },
      "loop.dat",
    );
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setTab("units"));
    await act(async () => {
      await result.current.convert();
    });
    expect(convertMagUnits).not.toHaveBeenCalled();
    expect(result.current.error).toContain("No finite field or moment values");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});
