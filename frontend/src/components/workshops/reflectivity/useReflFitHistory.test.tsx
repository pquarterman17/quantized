// P2.2 slice 3 — a finished reflectivity fit is a durable record: it is stored
// on its dataset, shown again when the workshop reopens, picked from a
// history, applied behind slice 2's guard, restored as a setup, named into
// the library, and sent to the report.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets } from "../../../lib/api/reflectivity";
import { reportEmit } from "../../../lib/api/report";
import { useApp } from "../../../store/useApp";
import { encodeRecord, recordsFor } from "./reflFitRecord";
import { fitResponse, makeRecord, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));
vi.mock("../../../lib/api/report", () => ({ reportEmit: vi.fn(), reportExport: vi.fn() }));

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

/** Run one fit through a fresh workshop, then close it. */
async function fitOnce(res = fitResponse(), setup?: (fit: ReturnType<typeof useBoth>["fit"]) => void) {
  vi.mocked(reflFit).mockResolvedValueOnce(res);
  const view = await mountHook();
  if (setup) act(() => setup(view.result.current.fit));
  await act(async () => {
    await view.result.current.fit.run();
  });
  const record = view.result.current.fit.liveRecord;
  view.unmount();
  return record;
}

const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  vi.mocked(reportEmit).mockImplementation(async (body) => ({
    report: { title: body.title ?? "", sections: [], source_refs: body.source_refs ?? [] },
  }));
  useApp.setState({
    datasets: [xrrDataset("xrr", { workbookId: "wb-x" })],
    activeId: "xrr",
    status: "",
    fitOverlay: null,
    reflectivitySeed: null,
    reports: [],
    resolveDataset: realResolve,
  });
});

describe("a finished fit is stored and restored", () => {
  it("stores the record on its dataset: request, bindings, model snapshot and result", async () => {
    const record = await fitOnce(fitResponse(), (fit) => {
      fit.setParam("L1.thickness", { vary: true });
      fit.setSettings({ qMin: 0.015 });
    });
    const [saved] = recordsFor(useApp.getState().datasets[0]);
    expect(saved).toEqual(record);
    expect(saved.seq).toBe(1);
    expect(saved.id).toMatch(/^rfit-/);
    expect(saved.request.parameters.find((p) => p.name === "L1.thickness")).toEqual({
      name: "L1.thickness", value: 200, vary: true, min: 100, max: 300, tie: null,
    });
    expect(saved.request.channels[0]).toMatchObject({
      datasetId: "xrr", rCol: 0, drCol: 1, dqCol: 2, rLabel: "Intensity", drLabel: "uncertainty", dqLabel: "resolution",
    });
    expect(saved.request.settings.qMin).toBe(0.015);
    expect(saved.model.layers.map((l) => l.preset)).toEqual(["Air / Vacuum", "Nickel", "Silicon"]);
    expect(saved.result.objective).toEqual({ label: "reduced χ²", value: 1.25 });
    expect(saved.result.parameters[1].stderr).toBeNull();
    expect("curves" in saved.result).toBe(false);
  });

  it("reopening the workshop shows the saved result: table, objective and warnings", async () => {
    await fitOnce();
    render(<Harness />);
    expect(await screen.findByLabelText("saved fit")).toBeTruthy();
    expect(screen.getByText(/Saved fit/).textContent).toMatch(/#1/);
    expect(screen.getByTestId("refl-fit-objective").textContent).toBe("1.25");
    expect(screen.getByText(/ended on a bound/)).toBeTruthy();
    expect(screen.getByText("± 0.8")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore fit setup" })).toBeTruthy();
  });

  it("the history picker lists every fit newest first and shows the one picked", async () => {
    await fitOnce(fitResponse({ reduced_chi2: 3.5 }));
    await fitOnce(fitResponse({ reduced_chi2: 1.02 }));
    render(<Harness />);
    const picker = (await screen.findByLabelText("saved fits")) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent?.slice(0, 2))).toEqual(["#2", "#1"]);
    expect(screen.getByTestId("refl-fit-objective").textContent).toBe("1.02");
    const first = recordsFor(useApp.getState().datasets[0])[1];
    fireEvent.change(picker, { target: { value: first.id } });
    expect(screen.getByTestId("refl-fit-objective").textContent).toBe("3.5");
  });

  it("flags a saved fit whose second channel's dataset has since been deleted", async () => {
    const rec = makeRecord({}, ["xrr", "gone"]);
    useApp.setState({ datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(rec)] })] });
    render(<Harness />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/channel 2: its dataset "gone.refl" is no longer in the library/);
  });
});

describe("a saved fit's actions", () => {
  it("Apply to model is guarded against a radiation switch and a changed stack", async () => {
    await fitOnce();
    const { result } = await mountHook();
    const h = () => result.current.fit.history;
    expect(h().selected?.seq).toBe(1);
    expect(h().applyBlocked).toBeNull();

    act(() => result.current.refl.setRadiation("neutron"));
    expect(h().applyBlocked).toMatch(/radiation changed/);
    act(() => h().applySaved());
    expect(result.current.refl.layers[1].thickness).toBe(200);
    expect(result.current.fit.error).toMatch(/cannot apply/);

    act(() => result.current.refl.setRadiation("xray"));
    act(() => result.current.refl.removeLayer(1));
    expect(h().applyBlocked).toMatch(/layer stack changed/);

    // Restoring the setup brings back the stack the fit ran on…
    act(() => h().restore());
    expect(result.current.refl.layers.map((l) => l.preset)).toEqual(["Air / Vacuum", "Nickel", "Silicon"]);
    expect(h().applyBlocked).toBeNull();
    // …and then the fitted values apply, and stay re-appliable.
    act(() => h().applySaved());
    expect(result.current.refl.layers[1]).toMatchObject({ preset: "Nickel", thickness: 187.5, roughness: 15 });
    expect(result.current.fit.params.find((p) => p.name === "scale")?.value).toBe(0.97);
    expect(h().applyBlocked).toBeNull();
  });

  it("Restore fit setup loads the saved parameters, bindings and data settings", async () => {
    await fitOnce(fitResponse(), (fit) => {
      fit.setParam("L1.thickness", { vary: true, min: 150, max: 250 });
      fit.setParam("scale", { vary: true });
      fit.setSettings({ qMin: 0.015, weighting: "log" });
    });
    const { result } = await mountHook();
    const fit = () => result.current.fit;
    expect(fit().settings.qMin).toBeNull();
    expect(fit().params.find((p) => p.name === "L1.thickness")?.vary).toBe(false);

    act(() => fit().history.restore());
    expect(fit().settings).toMatchObject({ qMin: 0.015, weighting: "log" });
    expect(fit().params.find((p) => p.name === "L1.thickness")).toMatchObject({ vary: true, min: 150, max: 250 });
    expect(fit().params.find((p) => p.name === "scale")?.vary).toBe(true);
    expect(fit().channels).toEqual([{ datasetId: "xrr", rCol: 0, drCol: 1, dqCol: 2, dqIsFwhm: false, spin: "none" }]);
    expect(fit().error).toBeNull();
  });

  it("Add to report sends the saved result through the report emitter", async () => {
    await fitOnce();
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    const entry = useApp.getState().reports[0];
    expect(entry.name).toBe("Reflectivity fit #1 — film.refl");
    expect(entry.datasetId).toBe("xrr");
    const body = vi.mocked(reportEmit).mock.calls[0][0];
    expect(body.kind).toBe("refl_fit");
    expect(body.source_refs).toEqual([{ kind: "dataset", id: "xrr", name: "film.refl" }]);
    expect((body.result as { objective: unknown }).objective).toEqual({ label: "reduced χ²", value: 1.25 });
  });
});

describe("a live fit", () => {
  it("adds fit curves named for the fit, placed with the source and pointing back at the record", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResponse());
    const { result } = await mountHook();
    await act(async () => {
      await result.current.fit.run();
    });
    const record = result.current.fit.liveRecord!;
    act(() => void result.current.fit.addCurves());
    const added = useApp.getState().datasets.slice(1);
    expect(added.map((d) => d.name)).toEqual(["film.refl — refl fit #1 model", "film.refl — refl fit #1 SLD"]);
    for (const d of added) {
      expect(d.workbookId).toBe("wb-x");
      expect(d.data.metadata).toMatchObject({
        source: "reflectivity-fit",
        reflFit: { fitId: record.id, seq: 1, sourceIds: ["xrr"], sourceNames: ["film.refl"] },
      });
      expect(d.derivedFrom).toBeUndefined(); // never a recalc-graph edge
    }
    // The next fit is #2, and its curves say so.
    await act(async () => {
      await result.current.fit.run();
    });
    act(() => void result.current.fit.addCurves());
    expect(useApp.getState().datasets.at(-2)?.name).toBe("film.refl — refl fit #2 model");
  });

  it("stays the result on show until another saved fit is picked", async () => {
    await fitOnce(fitResponse({ reduced_chi2: 3.5 }));
    vi.mocked(reflFit).mockResolvedValue(fitResponse({ reduced_chi2: 1.02 }));
    render(<Harness />);
    expect((await screen.findByTestId("refl-fit-objective")).textContent).toBe("3.5");
    fireEvent.click(screen.getByRole("button", { name: "Run fit" }));
    expect(await screen.findByRole("button", { name: "Add fit curves" })).toBeTruthy();
    expect(screen.getByTestId("refl-fit-objective").textContent).toBe("1.02");
    expect(screen.queryByLabelText("saved fit")).toBeNull();
    const older = recordsFor(useApp.getState().datasets[0])[1];
    fireEvent.change(screen.getByLabelText("saved fits"), { target: { value: older.id } });
    expect(screen.getByLabelText("saved fit")).toBeTruthy();
    expect(screen.getByTestId("refl-fit-objective").textContent).toBe("3.5");
  });
});
