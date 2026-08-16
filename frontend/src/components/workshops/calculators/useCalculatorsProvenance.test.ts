// Provenance contract for the shared-state calculator hooks
// (DIRACULATOR_AUDIT P1, over the P3-split domain hooks): a displayed result
// is either CURRENT for the visible inputs or gone. Races are forced with
// hand-resolved deferred promises — completion order is under test control,
// never timing luck (docs/testing.md evidence standard).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  convertUnits,
  crystalCell,
  crystalDSpacing,
  sldFromFormula,
  xrayCalc,
} from "../../../lib/api";
import { useCalcHistory } from "../../../store/calcHistory";
import { useCalculators } from "./useCalculators";

vi.mock("../../../lib/api", () => ({
  convertUnits: vi.fn(),
  getConstants: vi.fn().mockResolvedValue({ constants: {}, systems: { SI: [], CGS: [], eV: [] } }),
  xrayCalc: vi.fn(),
  crystalDSpacing: vi.fn(),
  crystalCell: vi.fn(),
  sldFromFormula: vi.fn(),
}));

vi.mock("../../../lib/api/reference", () => ({
  getUnitCategories: vi.fn().mockResolvedValue({ categories: [] }),
}));

/** A promise whose resolve/reject the test holds. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(convertUnits).mockReset();
  vi.mocked(xrayCalc).mockReset();
  vi.mocked(crystalDSpacing).mockReset();
  vi.mocked(crystalCell).mockReset();
  vi.mocked(sldFromFormula).mockReset();
  useCalcHistory.setState({ history: [], favorites: [], seq: 0 });
});

describe("units converter provenance", () => {
  it("editing the value invalidates the displayed result (the pre-audit gap)", async () => {
    vi.mocked(convertUnits).mockResolvedValue({ result: 0.0001, info: {} });
    const { result } = renderHook(() => useCalculators());
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.result).toBeCloseTo(0.0001, 8);

    act(() => result.current.setValue("2"));
    expect(result.current.result).toBeNull();
    expect(result.current.description).toBeNull();

    // setFrom / setTo invalidate the same way.
    vi.mocked(convertUnits).mockResolvedValue({ result: 5, info: {} });
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.result).toBe(5);
    act(() => result.current.setFrom("G"));
    expect(result.current.result).toBeNull();
  });

  it("an older in-flight convert never overwrites a newer result, in display OR history", async () => {
    const slow = deferred<{ result: number; info: object }>();
    const fast = deferred<{ result: number; info: object }>();
    vi.mocked(convertUnits)
      .mockReturnValueOnce(slow.promise as never)
      .mockReturnValueOnce(fast.promise as never);
    const { result } = renderHook(() => useCalculators());

    let p1: Promise<void>, p2: Promise<void>;
    act(() => {
      p1 = result.current.convert(); // issued first...
      p2 = result.current.convert();
    });
    await act(async () => {
      fast.resolve({ result: 222, info: {} });
      await p2;
    });
    expect(result.current.result).toBe(222);

    await act(async () => {
      slow.resolve({ result: 111, info: {} }); // ...completes last — disowned
      await p1;
    });
    expect(result.current.result).toBe(222);
    expect(useCalcHistory.getState().history).toHaveLength(1);
  });

  it("editing while a convert is pending disowns its completion and drops busy", async () => {
    const d = deferred<{ result: number; info: object }>();
    vi.mocked(convertUnits).mockReturnValue(d.promise as never);
    const { result } = renderHook(() => useCalculators());

    let p: Promise<void>;
    act(() => {
      p = result.current.convert();
    });
    expect(result.current.busy).toBe(true);
    act(() => result.current.setValue("7")); // inputs stay editable while pending
    expect(result.current.busy).toBe(false); // no current request anymore

    await act(async () => {
      d.resolve({ result: 999, info: {} });
      await p;
    });
    expect(result.current.result).toBeNull(); // answered a question no longer asked
    expect(useCalcHistory.getState().history).toHaveLength(0);
  });

  it("photon-panel edits invalidate the 5-quantity readout", async () => {
    vi.mocked(convertUnits).mockResolvedValue({ result: 42, info: {} });
    const { result } = renderHook(() => useCalculators());
    await act(async () => {
      await result.current.peCompute();
    });
    expect(result.current.peResults).not.toBeNull();
    act(() => result.current.setPeValue("2"));
    expect(result.current.peResults).toBeNull();
  });
});

describe("x-ray converter provenance", () => {
  it("every input setter invalidates the shown conversion", async () => {
    vi.mocked(xrayCalc).mockResolvedValue({ result: 28.44, unit: "deg", description: "" });
    const { result } = renderHook(() => useCalculators());
    for (const edit of [
      () => result.current.setWavelength("0.7107"),
      () => result.current.setXrayValue("2"),
      () => result.current.setXrayOrder("2"),
      () => result.current.setXrayMode("d_from_2theta"),
    ]) {
      await act(async () => {
        await result.current.xrayCompute();
      });
      expect(result.current.xrayResult).not.toBeNull();
      act(edit);
      expect(result.current.xrayResult).toBeNull();
      expect(result.current.xrayError).toBeNull();
    }
  });

  it("a stale x-ray completion is dropped after an input edit", async () => {
    const d = deferred<{ result: number; unit: string; description: string }>();
    vi.mocked(xrayCalc).mockReturnValue(d.promise as never);
    const { result } = renderHook(() => useCalculators());

    let p: Promise<void>;
    act(() => {
      p = result.current.xrayCompute();
    });
    act(() => result.current.setXrayValue("1.9"));
    await act(async () => {
      d.resolve({ result: 28.44, unit: "deg", description: "" });
      await p;
    });
    expect(result.current.xrayResult).toBeNull();
    expect(result.current.xrayBusy).toBe(false);
    expect(useCalcHistory.getState().history).toHaveLength(0);
  });
});

describe("crystal provenance — field-aware invalidation", () => {
  beforeEach(() => {
    vi.mocked(crystalDSpacing).mockResolvedValue({ d: 3.1356, system: "cubic" });
    vi.mocked(crystalCell).mockResolvedValue({ volume: 160.18, molar_mass: 28.09, density: 2.33 });
  });

  async function computeBoth(result: { current: ReturnType<typeof useCalculators> }) {
    await act(async () => {
      await result.current.crCompute();
      await result.current.cellCompute();
    });
    expect(result.current.crResult).not.toBeNull();
    expect(result.current.cellResult).not.toBeNull();
  }

  it("an hkl edit invalidates the d-spacing but leaves the cell result live", async () => {
    const { result } = renderHook(() => useCalculators());
    await computeBoth(result);
    act(() => result.current.updCrystal({ h: "2" }));
    expect(result.current.crResult).toBeNull();
    expect(result.current.cellResult).not.toBeNull(); // hkl never feed the cell calc
  });

  it("a formula/Z edit invalidates the cell result but leaves the d-spacing live", async () => {
    const { result } = renderHook(() => useCalculators());
    await computeBoth(result);
    act(() => result.current.updCrystal({ formula: "Ge" }));
    expect(result.current.cellResult).toBeNull();
    expect(result.current.crResult).not.toBeNull(); // formula never feeds d-spacing
  });

  it("a lattice edit invalidates both", async () => {
    const { result } = renderHook(() => useCalculators());
    await computeBoth(result);
    act(() => result.current.updCrystal({ a: "5.65" }));
    expect(result.current.crResult).toBeNull();
    expect(result.current.cellResult).toBeNull();
  });

  it("a stale d-spacing completion is dropped after a lattice edit", async () => {
    const d = deferred<{ d: number; system: string }>();
    vi.mocked(crystalDSpacing).mockReturnValue(d.promise as never);
    const { result } = renderHook(() => useCalculators());

    let p: Promise<void>;
    act(() => {
      p = result.current.crCompute();
    });
    act(() => result.current.updCrystal({ a: "4.05" }));
    await act(async () => {
      d.resolve({ d: 3.1356, system: "cubic" });
      await p;
    });
    expect(result.current.crResult).toBeNull();
    expect(useCalcHistory.getState().history).toHaveLength(0);
  });
});

describe("SLD provenance", () => {
  it("form edits and preset picks invalidate the shown SLD", async () => {
    vi.mocked(sldFromFormula).mockResolvedValue({
      formula: "Si",
      neutron: { sld_real: 2.07, sld_imag: 0 },
      xray: { sld_real: 20.07, sld_imag: 0.46 },
    } as never);
    const { result } = renderHook(() => useCalculators());
    await act(async () => {
      await result.current.sldCompute();
    });
    expect(result.current.sldResult).not.toBeNull();

    act(() => result.current.updSld({ density: "2.5" }));
    expect(result.current.sldResult).toBeNull();

    await act(async () => {
      await result.current.sldCompute();
    });
    expect(result.current.sldResult).not.toBeNull();
    act(() => result.current.setSldPreset("D2O", 1.11));
    expect(result.current.sldResult).toBeNull();
    expect(result.current.sld.formula).toBe("D2O");
  });
});
