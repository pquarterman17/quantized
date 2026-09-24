// P2.2 slice 3, review of defc9a13 — the live fit and the stored history stay
// in step: an undo that removes the live fit's record drops the live result, a
// fit is numbered from the library as it is when it returns, a fit whose
// datasets were all deleted stores nothing (not even an undo step), and a
// malformed stored history from a .dwk cannot break the next fit.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets, type ReflFitResult } from "../../../lib/api/reflectivity";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useApp } from "../../../store/useApp";
import { recordsFor } from "./reflFitRecord";
import { fitResponse, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

function useBoth() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return { refl, fit };
}

function Harness() {
  const { fit } = useBoth();
  return <ReflFitView fit={fit} />;
}

async function mountHook() {
  const view = renderHook(() => useBoth());
  await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(TEST_PRESETS.length));
  return view;
}

/** Start a fit whose response is released by the returned `finish`. */
async function startHeldFit() {
  let release: (r: ReflFitResult) => void = () => {};
  vi.mocked(reflFit).mockImplementationOnce(
    () =>
      new Promise<ReflFitResult>((resolve) => {
        release = resolve;
      }),
  );
  const view = await mountHook();
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = view.result.current.fit.run();
  });
  await waitFor(() => expect(view.result.current.fit.busy).toBe(true));
  const finish = async (res: ReflFitResult) => {
    await act(async () => {
      release(res);
      await pending;
    });
  };
  return { ...view, finish };
}

const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  useApp.setState({
    datasets: [xrrDataset("xrr")],
    activeId: "xrr",
    status: "",
    fitOverlay: null,
    reflectivitySeed: null,
    history: [],
    future: [],
    resolveDataset: realResolve,
  });
});

describe("the live fit and the stored history stay in step", () => {
  it("fit, fit again, Undo: the live #2 is dropped and the view falls back to the stored #1", async () => {
    vi.mocked(reflFit).mockResolvedValueOnce(fitResponse({ reduced_chi2: 3.5 }));
    vi.mocked(reflFit).mockResolvedValueOnce(fitResponse({ reduced_chi2: 1.02 }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Run fit" }));
    await waitFor(() => expect(screen.getByTestId("refl-fit-objective").textContent).toBe("3.5"));
    fireEvent.click(screen.getByRole("button", { name: "Run fit" }));
    await waitFor(() => expect(screen.getByTestId("refl-fit-objective").textContent).toBe("1.02"));
    expect(recordsFor(useApp.getState().datasets[0]).map((r) => r.seq)).toEqual([2, 1]);
    expect(useApp.getState().fitOverlay).not.toBeNull();

    act(() => useApp.getState().undo());
    expect(recordsFor(useApp.getState().datasets[0]).map((r) => r.seq)).toEqual([1]);
    // No live result is left that could be taken for #1 or name a gone #2:
    // no "Add fit curves", no overlay, and the saved #1 is on show as #1.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add fit curves" })).toBeNull());
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(screen.getByLabelText("saved fit")).toBeTruthy();
    expect(screen.getByText(/Saved fit/).textContent).toMatch(/#1/);
    expect(screen.getByTestId("refl-fit-objective").textContent).toBe("3.5");
    const picker = screen.getByLabelText("saved fits") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent?.slice(0, 2))).toEqual(["#1"]);
  });

  it("numbers a fit from the library as it is when the fit returns, past any fit curve's number", async () => {
    const { result, finish } = await startHeldFit();
    // While it runs, the curves of an earlier fit #4 of this dataset land.
    const base = xrrDataset("curve");
    const curve = { ...base, data: { ...base.data, metadata: { reflFit: { seq: 4, sourceIds: ["xrr"] } } } };
    act(() => useApp.setState((s) => ({ datasets: [...s.datasets, curve] })));
    await finish(fitResponse());
    expect(result.current.fit.liveRecord?.seq).toBe(5);
    expect(recordsFor(useApp.getState().datasets[0])[0].seq).toBe(5);
  });

  it("a fit whose dataset was deleted while it ran stores nothing and records no undo step", async () => {
    const { result, finish } = await startHeldFit();
    act(() => useApp.setState({ datasets: [] }));
    await finish(fitResponse());
    expect(result.current.fit.result).not.toBeNull();
    expect(result.current.fit.liveRecord).toBeNull();
    expect(useApp.getState().history.map((h) => h.label)).not.toContain("reflectivity fit");
  });

  it("a malformed stored history in a .dwk does not break the next fit", async () => {
    for (const junk of [{ "0": 1 }, "abc", 7]) {
      const doc = JSON.parse(serializeWorkspace({ datasets: [xrrDataset("xrr")] }));
      doc.datasets[0].reflFits = junk;
      const [reopened] = parseWorkspace(JSON.stringify(doc)).datasets;
      useApp.setState({ datasets: [reopened], activeId: "xrr" });
      vi.mocked(reflFit).mockResolvedValueOnce(fitResponse());
      const { result, unmount } = await mountHook();
      await act(async () => {
        await result.current.fit.run();
      });
      expect(result.current.fit.error).toBeNull();
      const record = result.current.fit.liveRecord;
      expect(record?.seq).toBe(1);
      expect(useApp.getState().datasets[0].reflFits).toHaveLength(1);
      expect(recordsFor(useApp.getState().datasets[0]).map((r) => r.id)).toEqual([record?.id]);
      unmount();
    }
  });
});
