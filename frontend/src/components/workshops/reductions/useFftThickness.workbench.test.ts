// FFT thickness "Out of date" (lane WB6). Compute stays a button; the result is
// stamped with the settings and source rows it ran with. When any of them moves
// the result is marked, and "→ Library" is withheld; a late answer for inputs
// that changed in flight lands marked, never current; a lazy book is resolved
// before the run so its arrival does not mark a fresh result.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fftThickness } from "../../../lib/api/reductions";
import type { FftThicknessResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useFftThickness } from "./useFftThickness";

vi.mock("../../../lib/api/reductions", () => ({ fftThickness: vi.fn() }));

const scan: DataStruct = { time: [10, 20, 30, 40], values: [[1], [2], [3], [4]], labels: ["Intensity"], units: ["cps"], metadata: {} };
const RES: FftThicknessResult = {
  thickness_nm: 55.5, uncertainty_nm: null, wavelength_a: 1.5406, two_theta_range: [10, 40],
  fft_magnitude: [0, 1, 2], thickness_axis: [0, 10, 20], n_points: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  vi.mocked(fftThickness).mockResolvedValue(RES);
  useApp.setState({
    datasets: [{ id: "d1", name: "xrd.dat", data: scan }], activeId: "d1", status: "", analysisResults: [], history: [], future: [],
  });
});

async function computed() {
  const hook = renderHook(() => useFftThickness());
  await act(async () => { await hook.result.current.compute(); });
  return hook;
}

describe("FFT thickness out-of-date state", () => {
  it("characterization: a fresh result is current and → Library adds the spectrum", async () => {
    const { result } = await computed();
    expect(result.current.result?.thickness_nm).toBe(55.5);
    expect(result.current.stale).toBe(false);
    expect(result.current.addDisabledReason).toBeNull();
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("a changed setting marks the result out of date and withholds → Library; changing it back restores it", async () => {
    const { result } = await computed();
    act(() => result.current.setWindowFn("blackman"));
    expect(result.current.result).not.toBeNull(); // still shown, marked
    expect(result.current.stale).toBe(true);
    expect(result.current.addDisabledReason).toMatch(/out of date/i);
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(1); // fail-before: it added the spectrum
    act(() => result.current.setWindowFn("hann"));
    expect(result.current.stale).toBe(false);
  });

  it("each input marks it: wavelength, 2θ range, max thickness", async () => {
    for (const change of [
      (h: ReturnType<typeof useFftThickness>) => h.setWavelength(1.79),
      (h: ReturnType<typeof useFftThickness>) => h.setTwoThetaMin(12),
      (h: ReturnType<typeof useFftThickness>) => h.setTwoThetaMax(35),
      (h: ReturnType<typeof useFftThickness>) => h.setMaxThicknessNm(100),
    ]) {
      const { result } = await computed();
      act(() => change(result.current));
      expect(result.current.stale).toBe(true);
    }
  });

  it("edited source rows (an exclusion) mark it out of date", async () => {
    const { result } = await computed();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
    expect(result.current.addDisabledReason).toMatch(/out of date/i);
  });

  it("forced race: a setting changed while the request is in flight leaves the landed result out of date", async () => {
    let land!: (r: FftThicknessResult) => void;
    vi.mocked(fftThickness).mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useFftThickness());
    let pending!: Promise<void>;
    act(() => { pending = result.current.compute(); });
    await act(async () => {});
    act(() => result.current.setWavelength(1.79));
    await act(async () => { land(RES); await pending; });
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(true); // fail-before: it landed as current
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("forced race: an answer for a dataset the user has since left is dropped", async () => {
    let land!: (r: FftThicknessResult) => void;
    vi.mocked(fftThickness).mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useFftThickness());
    let pending!: Promise<void>;
    act(() => { pending = result.current.compute(); });
    await act(async () => {});
    act(() => useApp.setState((s) => ({ datasets: [...s.datasets, { id: "d2", name: "b.dat", data: scan }], activeId: "d2" })));
    await act(async () => { land(RES); await pending; });
    expect(result.current.result).toBeNull(); // fail-before: d1's result showed on d2
  });

  it("forced race: rows changed while resolveDataset is pending leave the result stamped with the click's rows, so it lands out of date (fail-before: current)", async () => {
    // The run key's live ref catches up in a passive effect and was read after the awaits,
    // so a row change during them was stamped onto the old rows' answer. Forced here with
    // a deferred resolveDataset that returns the rows the click was made on.
    const clicked = useApp.getState().datasets[0];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    useApp.setState({ resolveDataset: async () => { await gate; return clicked; } });
    const { result } = renderHook(() => useFftThickness());
    let pending!: Promise<void>;
    act(() => { pending = result.current.compute(); });
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    await act(async () => { release(); await pending; });
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(true);
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("a lazy book is resolved before the run, so its arrival does not mark the fresh result", async () => {
    makePending({ id: "d1", name: "xrd.dat", data: scan });
    const { result } = await computed();
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it("a setting changed while a lazy book loads is not stamped onto a request that carries the old one (fail-before: current)", async () => {
    makePending({ id: "d1", name: "xrd.dat", data: scan });
    const install = useApp.getState().resolveDataset;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    useApp.setState({ resolveDataset: async (id: string) => { await gate; return install(id); } });
    const { result } = renderHook(() => useFftThickness());
    let pending!: Promise<void>;
    act(() => { pending = result.current.compute(); });
    act(() => result.current.setWavelength(1.79));
    await act(async () => { release(); await pending; });
    expect(fftThickness).not.toHaveBeenCalled(); // the run for the old wavelength is abandoned
    expect(result.current.result).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("a failed run keeps the previous result (marked if its inputs moved), as before", async () => {
    const { result } = await computed();
    act(() => result.current.setWavelength(1.79));
    vi.mocked(fftThickness).mockRejectedValueOnce(new Error("window too short"));
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toBe("window too short");
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(true);
  });

  it("Clear forgets the result and its stamp", async () => {
    const { result } = await computed();
    act(() => result.current.clear());
    expect(result.current.result).toBeNull();
    expect(result.current.stale).toBe(false);
  });
});
