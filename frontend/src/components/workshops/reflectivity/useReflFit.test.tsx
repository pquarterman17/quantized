import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets, type ReflFitResult } from "../../../lib/api/reflectivity";
import type { Dataset, SldPreset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import FitResults from "./FitResults";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
  { name: "Silicon Oxide", formula: "SiO2", sldX: 1.888e-5, sldN: 3.47e-6, sldImag: 0, density: 2.2 },
];

// An NCNR .refl-shaped dataset: Q, then [R, dR, dQ], with the parser's roles.
const Q = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
const XRR: Dataset = {
  id: "xrr",
  name: "film.refl",
  data: {
    time: Q,
    values: Q.map((q, i) => [1 / (1 + 100 * q * i), 0.01, 1e-4]),
    labels: ["Intensity", "uncertainty", "resolution"],
    units: ["arb. units", "arb. units", "1/Ang"],
    metadata: { x_column_unit: "1/Ang" },
  },
  errorRoles: [
    { channel: 1, target: 0, axis: "y", side: "both" },
    { channel: 2, target: -1, axis: "x", side: "both" },
  ],
} as Dataset;

const PNR: Dataset = {
  id: "pnr",
  name: "film.pnr",
  data: {
    time: Q,
    values: Q.map(() => [1e-4, 0.5, 1e-3, 0.4, 1e-3]),
    labels: ["dQ", "Rpp", "dRpp", "Rmm", "dRmm"],
    units: ["A-1", "", "", "", ""],
    metadata: {},
  },
} as Dataset;

const XRD: Dataset = {
  id: "xrd",
  name: "pattern.xrdml",
  data: { time: [1, 2, 3], values: [[1], [0.5], [0.2]], labels: ["Counts"], units: ["cts"], metadata: {} },
} as Dataset;

function fitResult(over: Partial<ReflFitResult> = {}): ReflFitResult {
  return {
    parameters: [
      { name: "L1.thickness", value: 187.5, stderr: 0.8, vary: true, tie: null, at_bound: false },
      { name: "L1.roughness", value: 15, stderr: null, vary: true, tie: null, at_bound: true },
      { name: "L2.sld", value: 2.1e-5, stderr: null, vary: false, tie: null, at_bound: false },
      { name: "scale", value: 0.97, stderr: 0.01, vary: true, tie: null, at_bound: false },
    ],
    free: ["L1.thickness", "L1.roughness", "scale"],
    correlation: [],
    chi2: 12,
    reduced_chi2: 1.25,
    sum_sq_log: null,
    reduced_sum_sq_log: null,
    n_points: 6,
    n_free: 3,
    success: true,
    message: "`ftol` termination condition is satisfied.",
    n_evaluations: 42,
    weighting: "dr",
    curves: [
      { label: "c", spin: null, q: [0.01, 0.03, 0.05], r: [1, 0.5, 0.2], dr: [0.01, 0.01, 0.01], model: [0.9, 0.4, 0.1], residual: [] },
    ],
    sld_profiles: [{ spin: null, z: [-10, 0, 10], sld: [0, 7e-5, 2e-5] }],
    warnings: ["parameters ended on a bound (errors not reported): L1.roughness"],
    ...over,
  };
}

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
  await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(PRESETS.length));
  return view;
}

const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(reflPresets).mockResolvedValue({ presets: PRESETS });
  useApp.setState({
    datasets: [XRR, PNR, XRD],
    activeId: "xrr",
    status: "",
    fitOverlay: null,
    reflectivitySeed: null,
    resolveDataset: realResolve,
  });
});

describe("useReflFit", () => {
  it("prefills the channel from the active dataset's error roles", async () => {
    const { result } = await mountHook();
    expect(result.current.fit.channels).toEqual([
      { datasetId: "xrr", rCol: 0, drCol: 1, dqCol: 2, dqIsFwhm: false, spin: "none" },
    ]);
    expect(result.current.fit.weighting).toBe("dr");
  });

  it("prefills a lazy dataset once it has been fetched", async () => {
    const lazy = { ...XRR, id: "lazy", pending: {}, data: { ...XRR.data, labels: [], values: [] } } as unknown as Dataset;
    const full = { ...XRR, id: "lazy" };
    useApp.setState({
      datasets: [XRR, lazy],
      resolveDataset: async (id: string) => (id === "lazy" ? full : undefined),
    });
    const { result } = await mountHook();
    act(() => result.current.fit.selectDataset("lazy"));
    await waitFor(() => expect(result.current.fit.channels[0]).toMatchObject({ datasetId: "lazy", drCol: 1, dqCol: 2 }));
  });

  it("Run posts the parameters, channel and weighting, then overlays the fit on the dataset rows", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResult());
    const { result } = await mountHook();
    act(() => result.current.fit.setParam("L1.thickness", { vary: true }));
    act(() => result.current.fit.setSettings({ resolution: 0.03 })); // ignored: a dQ column is bound

    await act(async () => {
      await result.current.fit.run();
    });

    expect(reflFit).toHaveBeenCalledTimes(1);
    const [body, signal] = vi.mocked(reflFit).mock.calls[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(body.weighting).toBe("dr");
    expect(body.parameters.find((p) => p.name === "L1.thickness")).toEqual({
      name: "L1.thickness",
      value: 200,
      vary: true,
      min: 100,
      max: 300,
      tie: null,
    });
    expect(body.parameters.map((p) => p.name)).not.toContain("L0.thickness");
    const ch = body.channels[0];
    expect(ch.q).toEqual(Q);
    expect(ch.dr).toEqual(Q.map(() => 0.01));
    expect(ch.dq).toEqual(Q.map(() => 1e-4));
    expect(ch.resolution).toBeNull(); // never both dq and resolution
    expect(ch.spin).toBeNull();

    expect(result.current.fit.result?.n_evaluations).toBe(42);
    // returned q 0.01/0.03/0.05 are rows 0/2/4 of the dataset
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "xrr", y: [0.9, null, 0.4, null, 0.1, null] });
  });

  it("fits a PNR pair: two spin channels and msld parameters", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResult());
    const { result } = await mountHook();
    act(() => result.current.fit.selectDataset("pnr"));
    expect(result.current.fit.channels.map((c) => c.spin)).toEqual(["+", "-"]);
    expect(result.current.fit.params.map((p) => p.name)).toContain("L1.msld");
    expect(result.current.fit.params.map((p) => p.name)).not.toContain("L0.msld");

    await act(async () => {
      await result.current.fit.run();
    });
    const body = vi.mocked(reflFit).mock.calls[0][0];
    expect(body.channels.map((c) => [c.spin, c.r[0]])).toEqual([
      ["+", 0.5],
      ["-", 0.4],
    ]);
  });

  it("refuses 2θ data with no wavelength: visible message, no request", async () => {
    const { result } = await mountHook();
    act(() => result.current.fit.selectDataset("xrd"));
    act(() => result.current.fit.setSettings({ xKind: "twotheta" }));
    expect(result.current.fit.lambda).toBeNull();

    await act(async () => {
      await result.current.fit.run();
    });
    expect(reflFit).not.toHaveBeenCalled();
    expect(result.current.fit.error).toMatch(/wavelength is unknown/);

    act(() => result.current.fit.setSettings({ lambda: 1.5406 }));
    expect(result.current.fit.lambda).toBe(1.5406);
  });

  it("converts 2θ with the wavelength from the dataset's metadata and fits log R without dR", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResult({ weighting: "log" }));
    const cu: Dataset = { ...XRD, id: "cu", data: { ...XRD.data, metadata: { wavelength_a: 1.5406 } } };
    useApp.setState({ datasets: [XRR, cu], activeId: "cu" });
    const { result } = await mountHook();
    expect(result.current.fit.settings.xKind).toBe("twotheta");
    expect(result.current.fit.lambda).toBe(1.5406);
    await act(async () => {
      await result.current.fit.run();
    });
    const body = vi.mocked(reflFit).mock.calls[0][0];
    expect(body.weighting).toBe("log");
    expect(body.channels[0].q[1]).toBeCloseTo(0.14235584019, 10); // 2θ = 2°
    expect(body.channels[0].dr).toBeNull();
  });

  it("editing a parameter value edits the shared layer model", async () => {
    const { result } = await mountHook();
    act(() => result.current.fit.setParam("L1.thickness", { value: 150 }));
    expect(result.current.refl.layers[1].thickness).toBe(150);
    act(() => result.current.fit.setParam("L1.sld", { value: 7e-5 }));
    expect(result.current.refl.layers[1]).toMatchObject({ preset: "", sld: 7e-5, isld: 5e-7 });
  });

  it("Apply to model writes fitted values back; SLDs that moved become manual", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResult());
    const { result } = await mountHook();
    await act(async () => {
      await result.current.fit.run();
    });
    act(() => result.current.fit.applyToModel());
    const layers = result.current.refl.layers;
    expect(layers[1]).toMatchObject({ preset: "Nickel", thickness: 187.5, roughness: 15 });
    expect(layers[2]).toMatchObject({ preset: "", sld: 2.1e-5 });
    expect(result.current.fit.params.find((p) => p.name === "scale")?.value).toBe(0.97);
  });

  it("adds fit curves and SLD profiles, and opens a log-Y plot of them", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResult());
    const { result } = await mountHook();
    await act(async () => {
      await result.current.fit.run();
    });
    const before = useApp.getState().plotWindows.length;
    act(() => result.current.fit.openLogPlot());

    const added = useApp.getState().datasets.slice(3);
    expect(added.map((d) => d.data.labels)).toEqual([["R", "R fit"], ["SLD"]]);
    expect(added[0].data.values).toEqual([[1, 0.9], [0.5, 0.4], [0.2, 0.1]]);
    const wins = useApp.getState().plotWindows;
    expect(wins).toHaveLength(before + 1);
    expect(wins[wins.length - 1]).toMatchObject({ datasetId: added[0].id, view: { yScale: "log" } });
    expect(result.current.fit.curvesAdded).toBe(true);
  });
});

// Review round 1 (6eb29666) regressions.
describe("useReflFit — result validity", () => {
  async function fitted() {
    vi.mocked(reflFit).mockResolvedValue(fitResult());
    const view = await mountHook();
    await act(async () => {
      await view.result.current.fit.run();
    });
    expect(view.result.current.fit.result).not.toBeNull();
    return view;
  }

  it("refuses to apply a result by name to a stack whose layers moved (a removed layer)", async () => {
    const { result } = await fitted();
    expect(result.current.fit.applyBlocked).toBeNull();
    act(() => result.current.refl.removeLayer(1)); // Air / Ni / Si -> Air / Si
    expect(result.current.fit.applyBlocked).toMatch(/layer stack changed/);

    act(() => result.current.fit.applyToModel());
    // L1.thickness (the film's 187.5 Å) must NOT land on what is now the substrate
    expect(result.current.refl.layers).toEqual([
      { preset: "Air / Vacuum", thickness: 0, roughness: 0, sld: 0 },
      { preset: "Silicon", thickness: 0, roughness: 3, sld: 0 },
    ]);
    expect(result.current.fit.error).toMatch(/cannot apply/);
  });

  it("refuses to apply after a radiation switch (presets would resolve to the other SLD)", async () => {
    const { result } = await fitted();
    act(() => result.current.refl.setRadiation("neutron"));
    expect(result.current.fit.applyBlocked).toMatch(/radiation changed/);
    act(() => result.current.fit.applyToModel());
    expect(result.current.refl.layers[1].preset).toBe("Nickel");
    expect(result.current.refl.layers[1].thickness).toBe(200);
  });

  it("stays applicable after its own Apply turned a moved SLD row manual", async () => {
    const { result } = await fitted();
    act(() => result.current.fit.applyToModel());
    expect(result.current.refl.layers[2].preset).toBe("");
    expect(result.current.fit.applyBlocked).toBeNull();
  });

  it("drops a late response once the data binding changed mid-fit (forced race)", async () => {
    let finish: (r: ReflFitResult) => void = () => {};
    let seen: AbortSignal | undefined;
    // Deliberately ignores the abort, like a response already in flight.
    vi.mocked(reflFit).mockImplementation((_b, signal) => {
      seen = signal;
      return new Promise<ReflFitResult>((resolve) => {
        finish = resolve;
      });
    });
    const { result } = await mountHook();
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.fit.run();
    });
    await waitFor(() => expect(seen).toBeDefined());
    expect(result.current.fit.busy).toBe(true);

    act(() => result.current.fit.selectDataset("pnr"));
    expect(result.current.fit.busy).toBe(false);
    expect(seen?.aborted).toBe(true);

    await act(async () => {
      finish(fitResult());
      await pending;
    });
    expect(result.current.fit.result).toBeNull();
    expect(result.current.fit.channels[0].datasetId).toBe("pnr");
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("a channel edit or Q-window change mid-fit also abandons the fit", async () => {
    vi.mocked(reflFit).mockImplementation((_b, signal) => new Promise((_res, rej) => {
      signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const { result } = await mountHook();
    act(() => void result.current.fit.run());
    await waitFor(() => expect(result.current.fit.busy).toBe(true));
    act(() => result.current.fit.setChannel(0, { drCol: null }));
    expect(result.current.fit.busy).toBe(false);

    act(() => void result.current.fit.run());
    await waitFor(() => expect(result.current.fit.busy).toBe(true));
    act(() => result.current.fit.setSettings({ qMin: 0.02 }));
    expect(result.current.fit.busy).toBe(false);
    expect(result.current.fit.error).toBeNull();
  });

  it("clears its own overlay when a new run fails, never another workshop's", async () => {
    const { result } = await fitted();
    expect(useApp.getState().fitOverlay?.datasetId).toBe("xrr");

    act(() => result.current.fit.setSettings({ qMin: 0.5 })); // no points left
    await act(async () => {
      await result.current.fit.run();
    });
    expect(result.current.fit.error).toMatch(/fewer than 2/);
    expect(useApp.getState().fitOverlay).toBeNull();

    // someone else's overlay on the same dataset survives our next failure
    const theirs = { datasetId: "xrr", y: [1, 2, 3, 4, 5, 6] };
    act(() => useApp.getState().setFitOverlay(theirs));
    await act(async () => {
      await result.current.fit.run();
    });
    expect(useApp.getState().fitOverlay).toBe(theirs);
  });

  it("binding channel 2 to a PNR file takes the columns of channel 2's spin", async () => {
    const { result } = await mountHook(); // XRR, one unpolarised channel
    act(() => result.current.fit.addChannel());
    expect(result.current.fit.channels.map((c) => c.spin)).toEqual(["+", "-"]);
    act(() => result.current.fit.setChannel(1, { datasetId: "pnr" }));
    expect(result.current.fit.channels[1]).toEqual({
      datasetId: "pnr",
      rCol: 3, // Rmm
      drCol: 4, // dRmm
      dqCol: 0,
      dqIsFwhm: false,
      spin: "-",
    });
  });
});

describe("ReflFitView", () => {
  it("shows SLDs compactly in the parameter table and keeps them editable", async () => {
    render(<Harness />);
    const sld = (await screen.findByRole("textbox", { name: "L1.sld value" })) as HTMLInputElement;
    await waitFor(() => expect(sld.value).toBe("7.18e-5"));
    fireEvent.change(sld, { target: { value: "0.0000025" } });
    expect(sld.value).toBe("0.0000025"); // not rewritten mid-entry
    fireEvent.blur(sld);
    expect(sld.value).toBe("2.5e-6");
    expect((screen.getByRole("textbox", { name: "L1.thickness value" }) as HTMLInputElement).value).toBe("200");
  });

  it("disables Apply and says why once the stack changed", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResult());
    function WithRemove() {
      const { refl, fit } = useBoth();
      return (
        <>
          <button onClick={() => refl.removeLayer(1)}>remove film</button>
          <ReflFitView fit={fit} />
        </>
      );
    }
    render(<WithRemove />);
    fireEvent.click(await screen.findByRole("button", { name: "Run fit" }));
    const apply = await screen.findByRole("button", { name: "Apply to model" });
    expect(apply).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "remove film" }));
    expect(screen.getByRole("button", { name: "Apply to model" })).toBeDisabled();
    expect(screen.getByText(/Apply is unavailable: the layer stack changed/)).toBeInTheDocument();
  });

  it("shows the backend's 422 detail through the standard error extraction", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/api/reflectivity")>("../../../lib/api/reflectivity");
    vi.mocked(reflFit).mockImplementation(actual.reflFit);
    const detail = "L1.msld has no effect on the model and cannot be fitted";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail }), { status: 422, statusText: "Unprocessable Entity" })),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Run fit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(detail);
  });

  it("Cancel aborts the request and returns to idle without an error", async () => {
    let seen: AbortSignal | undefined;
    vi.mocked(reflFit).mockImplementation(
      (_body, signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Run fit" }));
    const busy = await screen.findByRole("button", { name: "Fitting…" });
    expect(busy).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run fit" })).toBeEnabled());
    expect(seen?.aborted).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useApp.getState().status).toBe("reflectivity fit cancelled");
  });

  it("disables Run and says why when 2θ data has no wavelength", async () => {
    useApp.setState({ activeId: "xrd" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "2θ (deg)" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/wavelength is unknown/);
    expect(screen.getByRole("button", { name: "Run fit" })).toBeDisabled();
  });

  it("offers the dR weighting only when a dR column is bound", async () => {
    useApp.setState({ activeId: "xrd" });
    render(<Harness />);
    const dr = screen.getByRole("option", { name: /1\/dR/ }) as HTMLOptionElement;
    expect(dr.disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "weighting" }) as HTMLSelectElement).value).toBe("log");
  });
});

describe("FitResults", () => {
  it("renders value ± stderr, a dash for a missing error, and the bound flag", () => {
    render(<FitResults result={fitResult()} />);
    expect(screen.getByText("reduced χ²")).toBeInTheDocument();
    expect(screen.getByTestId("refl-fit-objective")).toHaveTextContent("1.25");
    const rough = screen.getByRole("rowheader", { name: "L1.roughness" }).parentElement!;
    expect(rough).toHaveTextContent("—");
    expect(rough).toHaveTextContent("at bound");
    const thick = screen.getByRole("rowheader", { name: "L1.thickness" }).parentElement!;
    expect(thick).toHaveTextContent("± 0.8");
    expect(screen.getByText(/ended on a bound/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("never labels the log-weighted objective a χ²", () => {
    const { container } = render(
      <FitResults
        result={fitResult({ weighting: "log", chi2: null, reduced_chi2: null, sum_sq_log: 0.4, reduced_sum_sq_log: 0.004 })}
      />,
    );
    expect(container.textContent).not.toMatch(/χ|chi/i);
    expect(screen.getByTestId("refl-fit-objective")).toHaveTextContent("0.004");
  });
});
