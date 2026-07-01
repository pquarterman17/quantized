import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflPresets, reflSimulate, reflSldProfile } from "../../../lib/api";
import type { SldPreset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useReflectivity } from "./useReflectivity";

vi.mock("../../../lib/api", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
}));

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
  { name: "Silicon Oxide", formula: "SiO2", sldX: 1.888e-5, sldN: 3.47e-6, sldImag: 0, density: 2.2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: PRESETS });
  useApp.setState({ datasets: [], activeId: null, status: "", reflectivitySeed: null });
});

async function mountLoaded() {
  const view = renderHook(() => useReflectivity());
  await waitFor(() => expect(view.result.current.presets.length).toBe(PRESETS.length));
  return view;
}

describe("useReflectivity", () => {
  it("loads presets on mount", async () => {
    const { result } = await mountLoaded();
    expect(result.current.presets[1].name).toBe("Nickel");
    expect(result.current.layers).toHaveLength(3); // vacuum / film / substrate
  });

  it("converts rows to [t, sld, imag, σ] using the X-ray SLD + imag", async () => {
    vi.mocked(reflSimulate).mockResolvedValue({ q: [0.01, 0.02], r: [1, 0.5] });
    const { result } = await mountLoaded();

    await act(async () => {
      await result.current.simulate();
    });

    const body = vi.mocked(reflSimulate).mock.calls[0][0];
    // Nickel film: thickness 200, X-ray SLD 7.18e-5, imag 5e-7, roughness 5.
    expect(body.layers[1]).toEqual([200, 7.18e-5, 5e-7, 5]);
    // Silicon substrate: X-ray SLD, imag carried, roughness 3.
    expect(body.layers[2]).toEqual([0, 2.007e-5, 0, 3]);
  });

  it("uses the neutron SLD and zero imag when radiation is neutron", async () => {
    vi.mocked(reflSimulate).mockResolvedValue({ q: [0.01], r: [1] });
    const { result } = await mountLoaded();

    act(() => result.current.setRadiation("neutron"));
    await act(async () => {
      await result.current.simulate();
    });

    const body = vi.mocked(reflSimulate).mock.calls[0][0];
    expect(body.layers[1]).toEqual([200, 9.4e-6, 0, 5]); // neutron SLD, imag 0
  });

  it("adds the simulated R(Q) to the library as a new dataset", async () => {
    vi.mocked(reflSimulate).mockResolvedValue({ q: [0.01, 0.02, 0.03], r: [1, 0.5, 0.2] });
    const { result } = await mountLoaded();

    await act(async () => {
      await result.current.simulate();
    });

    const datasets = useApp.getState().datasets;
    expect(datasets).toHaveLength(1);
    expect(datasets[0].data.time).toEqual([0.01, 0.02, 0.03]);
    expect(datasets[0].data.values).toEqual([[1], [0.5], [0.2]]);
    expect(datasets[0].data.labels).toEqual(["Reflectivity"]);
    expect(datasets[0].name).toMatch(/^Reflectivity model/);
  });

  it("sldProfile adds the SLD(z) depth profile as its own dataset", async () => {
    vi.mocked(reflSldProfile).mockResolvedValue({ z: [-50, 0, 50], sld: [0, 3e-6, 2e-6] });
    const { result } = await mountLoaded();

    await act(async () => {
      await result.current.sldProfile();
    });

    expect(reflSldProfile).toHaveBeenCalledWith({ layers: expect.any(Array) });
    const datasets = useApp.getState().datasets;
    expect(datasets).toHaveLength(1);
    expect(datasets[0].name).toMatch(/^SLD profile/);
    expect(datasets[0].data.time).toEqual([-50, 0, 50]);
    expect(datasets[0].data.values).toEqual([[0], [3e-6], [2e-6]]);
    expect(datasets[0].data.labels).toEqual(["SLD"]);
  });

  it("addLayer inserts above the substrate; removeLayer keeps ≥2 rows", async () => {
    const { result } = await mountLoaded();

    act(() => result.current.addLayer());
    expect(result.current.layers).toHaveLength(4);
    expect(result.current.layers[3].preset).toBe("Silicon"); // substrate still last

    act(() => result.current.removeLayer(1));
    act(() => result.current.removeLayer(1));
    expect(result.current.layers).toHaveLength(2);
    act(() => result.current.removeLayer(0)); // would drop below 2 → ignored
    expect(result.current.layers).toHaveLength(2);
  });

  it("consumes an SLD seed from the calculator as a manual layer above the substrate", async () => {
    const { result } = await mountLoaded();
    expect(result.current.layers).toHaveLength(3);

    act(() => {
      useApp.getState().seedReflectivityLayer({ sld: 3.47e-6, label: "SiO2 neutron" });
    });

    await waitFor(() => expect(result.current.layers).toHaveLength(4));
    const inserted = result.current.layers[2]; // just above the substrate
    expect(inserted.preset).toBe(""); // manual SLD
    expect(inserted.sld).toBe(3.47e-6);
    expect(result.current.layers[3].preset).toBe("Silicon"); // substrate still last
    // the one-shot seed is cleared, and a status line records the provenance
    expect(useApp.getState().reflectivitySeed).toBeNull();
    expect(useApp.getState().status).toContain("SiO2 neutron");
  });

  it("surfaces a simulation error without adding a dataset", async () => {
    vi.mocked(reflSimulate).mockRejectedValue(new Error("q_max must exceed q_min"));
    const { result } = await mountLoaded();

    await act(async () => {
      await result.current.simulate();
    });

    expect(result.current.error).toContain("q_max");
    expect(useApp.getState().datasets).toHaveLength(0);
  });
});
