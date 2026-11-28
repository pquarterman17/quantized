// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9) for the
// Reductions window's Williamson-Hall, Pawley, Reflectivity FFT and XRD
// reference pattern methods, through the real window, hooks and storage: save,
// change, Apply restores the settings and the next request carries them; Revert;
// Apply runs nothing and writes no last used, a real run does; a channel this
// sheet lacks is named and skipped; the peaks, the scan and the loaded pattern
// are data and are never stored; a refused value in a hidden knob does not block
// Save.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pawleyRefine, reflectivityFft, williamsonHall } from "../../../lib/api/reductions";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import type { ReductionsMethod } from "../../../store/reductions";
import { useApp } from "../../../store/useApp";
import ReductionsPanel from "./ReductionsPanel";

vi.mock("../../../lib/api/reductions", () => ({
  fftThickness: vi.fn(), williamsonHall: vi.fn(), pawleyRefine: vi.fn(), reflectivityFft: vi.fn(),
  xrdPhases: vi.fn(async () => ({ phases: [], default_wavelength: 1.5406 })),
}));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const scan: DataStruct = {
  time: [20, 30, 40, 50],
  values: [[1, 5], [2, 6], [3, 7], [4, 8]],
  labels: ["Intensity", "Counts"],
  units: ["cps", "cps"],
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg" },
};
const OTHER: DataStruct = { ...scan, labels: ["Intensity", "Other"] };
const PAWLEY: PawleyResult = {
  cell: [5.42, 5.42, 5.42, 90, 90, 90], cell_initial: [5.43, 5.43, 5.43, 90, 90, 90], scale: null, peaks: [],
  background: [0, 0, 0, 0], model: [1, 2, 3, 4], residual: [0, 0, 0, 0], rwp: 0.05, rwp_initial: 0.2, rwp_background: 0.5,
  converged: true, tie: "abc", hkl_max: 8, n_peaks: 7,
};
const REFL = {
  thicknesses_nm: [30], amplitudes: [1], harmonic_labels: [""], q_range: [0, 1] as [number, number], preprocess: "logR", fft_magnitude: [0, 1], thickness_axis: [0, 10], is_neutron: false,
  superlattice: { detected: false, bilayer_period_nm: null, total_thickness_nm: null, n_repeats: null, sublayer_a_nm: null, sublayer_b_nm: null, suppressed_orders: [] },
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.mocked(williamsonHall).mockResolvedValue({ grain_size_nm: 12, microstrain: 0.001, r2: 0.99 } as never);
  vi.mocked(pawleyRefine).mockResolvedValue(PAWLEY);
  vi.mocked(reflectivityFft).mockResolvedValue(REFL as never);
  useApp.setState({
    datasets: [{ id: "d1", name: "xrd.dat", data: scan }, { id: "d2", name: "other.dat", data: OTHER }],
    activeId: "d1", xKey: null, yKeys: [0], status: "", analysisResults: [], history: [], future: [], refLines: [], reductionsOpen: true,
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const statusOf = (tool: string) => within(screen.getByRole("region", { name: `${tool} presets` })).getByRole("status").textContent ?? "";
const sibling = (text: string) => screen.getByText(text).nextElementSibling as HTMLInputElement;
const type = (el: HTMLElement, v: string) => { fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); };
function savePreset(name: string) {
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
}
function pick(label: string) {
  const opt = within(select()).getAllByRole("option").find((o) => o.textContent?.startsWith(label));
  if (!opt) throw new Error(`no option ${label}`);
  fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
}
async function open(method: ReductionsMethod, tool: string) {
  useApp.setState({ reductionsMethod: method });
  render(<ReductionsPanel />);
  await screen.findByRole("region", { name: `${tool} presets` });
}
const storedPresets = () => JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets as { settings: Record<string, unknown> }[];

describe("Williamson-Hall preset bar", () => {
  const TOOL = "Williamson-Hall";
  const peaks = () => { type(screen.getByLabelText("peak 1 2θ"), "30"); type(screen.getByLabelText("peak 1 FWHM"), "0.2"); type(screen.getByLabelText("peak 2 2θ"), "43"); type(screen.getByLabelText("peak 2 FWHM"), "0.25"); };

  it("saves, changes, Applies: the settings return, the peaks are untouched, the next Fit carries them; a real Fit writes last used", async () => {
    await open("williamson-hall", TOOL);
    peaks();
    type(screen.getByLabelText("Wavelength (Å)"), "0.7107");
    type(sibling("K factor"), "0.94");
    type(sibling("Instrument broadening (°)"), "0.05");
    savePreset("Mo Kα");
    expect(statusOf(TOOL)).toBe("Saved preset 'Mo Kα'");
    type(screen.getByLabelText("Wavelength (Å)"), "1.5406");
    type(sibling("K factor"), "0.9");
    pick("Mo Kα");
    press("Apply");
    expect(statusOf(TOOL)).toContain("Applied preset 'Mo Kα' to Williamson-Hall: press Fit to run it");
    expect(statusOf(TOOL)).toContain("enter or load the peaks: a preset does not store them");
    expect((screen.getByLabelText("Wavelength (Å)") as HTMLInputElement).value).toBe("0.7107");
    expect(sibling("K factor").value).toBe("0.94");
    expect((screen.getByLabelText("peak 1 2θ") as HTMLInputElement).value).toBe("30"); // the data stayed
    expect(williamsonHall).not.toHaveBeenCalled();
    expect(readLastUsed("williamson-hall")).toBeNull();
    press("Revert");
    expect((screen.getByLabelText("Wavelength (Å)") as HTMLInputElement).value).toBe("1.5406");
    pick("Mo Kα");
    press("Apply");
    press("Fit");
    await waitFor(() => expect(readLastUsed("williamson-hall")).not.toBeNull());
    expect(vi.mocked(williamsonHall).mock.calls[0]?.[0]).toMatchObject({ wavelength_a: 0.7107, k_factor: 0.94, instrumental_broadening_deg: 0.05, two_theta_deg: [30, 43] });
    expect(readLastUsed("williamson-hall")?.settings).toEqual({ wavelength: 0.7107, kFactor: 0.94, instrumentalBroadening: 0.05 });
    expect(Object.keys(storedPresets()[0]!.settings).sort()).toEqual(["instrumentalBroadening", "kFactor", "wavelength"]); // no peak rows
  });

  it("a failed Fit writes no last used", async () => {
    vi.mocked(williamsonHall).mockRejectedValueOnce(new Error("singular"));
    await open("williamson-hall", TOOL);
    peaks();
    press("Fit");
    expect(await screen.findByText("singular")).toBeInTheDocument();
    expect(readLastUsed("williamson-hall")).toBeNull();
  });
});

describe("Pawley preset bar", () => {
  const TOOL = "Pawley refinement";
  const channel = () => screen.getByText("Intensity channel").nextElementSibling as HTMLSelectElement;

  it("saves, changes, Applies: channel, cell and options return, the next Refine carries them; a real Refine writes last used", async () => {
    await open("pawley", TOOL);
    fireEvent.change(channel(), { target: { value: "1" } });
    fireEvent.change(screen.getByText("Centering").nextElementSibling!, { target: { value: "F" } });
    type(screen.getByLabelText("a (Å)"), "4.05");
    type(screen.getByLabelText("Profile FWHM (°)"), "0.2");
    fireEvent.click(screen.getByRole("checkbox", { name: /Refine unit cell/ })); // off
    savePreset("Al fcc");
    fireEvent.change(channel(), { target: { value: "0" } });
    fireEvent.change(screen.getByText("Centering").nextElementSibling!, { target: { value: "P" } });
    type(screen.getByLabelText("a (Å)"), "5.43");
    fireEvent.click(screen.getByRole("checkbox", { name: /Refine unit cell/ })); // on
    pick("Al fcc");
    press("Apply");
    expect(statusOf(TOOL)).toContain("Applied preset 'Al fcc' to Pawley refinement: press Refine to run it");
    expect(channel().value).toBe("1"); // by label
    expect((screen.getByLabelText("a (Å)") as HTMLInputElement).value).toBe("4.05");
    expect((screen.getByText("Centering").nextElementSibling as HTMLSelectElement).value).toBe("F");
    expect(screen.getByRole("checkbox", { name: /Refine unit cell/ })).not.toBeChecked();
    expect(pawleyRefine).not.toHaveBeenCalled();
    expect(readLastUsed("pawley")).toBeNull();
    press("Revert");
    expect((screen.getByLabelText("a (Å)") as HTMLInputElement).value).toBe("5.43");
    pick("Al fcc");
    press("Apply");
    press("Refine");
    await waitFor(() => expect(readLastUsed("pawley")).not.toBeNull());
    expect(vi.mocked(pawleyRefine).mock.calls[0]?.[0]).toMatchObject({ intensity: [5, 6, 7, 8], symmetry: "F", refine_cell: false });
    expect(readLastUsed("pawley")?.settings).toMatchObject({ column: "Counts", a: "4.05", symmetry: "F", refineCell: false, fwhm: "0.2" });
  });

  it("a refused value in an axis the tie hides does not block Save, and a missing channel is named and skipped", async () => {
    await open("pawley", TOOL);
    fireEvent.change(screen.getByText("Axes").nextElementSibling!, { target: { value: "none" } }); // b and c shown
    type(screen.getByLabelText("b (Å)"), "0"); // refused while shown
    fireEvent.change(screen.getByText("Axes").nextElementSibling!, { target: { value: "abc" } }); // b and c hidden
    fireEvent.change(channel(), { target: { value: "1" } });
    savePreset("Cubic");
    expect(statusOf(TOOL)).toBe("Saved preset 'Cubic'");
    expect(storedPresets()[0]!.settings).toMatchObject({ tie: "abc", b: "5.43", column: "Counts" });
    act(() => useApp.setState({ activeId: "d2" })); // no "Counts" here
    await waitFor(() => expect(channel().value).toBe("0"));
    pick("Cubic");
    press("Apply");
    expect(statusOf(TOOL)).toContain("intensity channel skipped (column 'Counts' is not on this sheet)");
    expect(channel().value).toBe("0");
  });
});

describe("Reflectivity FFT preset bar", () => {
  const TOOL = "Reflectivity FFT";
  const channel = () => screen.getByText("Reflectivity channel").nextElementSibling as HTMLSelectElement;
  const neutron = () => screen.getByRole("checkbox", { name: /Neutron/ });

  it("saves, changes, Applies: settings return and the next Compute carries them; a real Compute writes last used", async () => {
    await open("reflectivity-fft", TOOL);
    fireEvent.change(channel(), { target: { value: "1" } });
    fireEvent.change(screen.getByText("Preprocess").nextElementSibling!, { target: { value: "RQ4" } });
    fireEvent.change(screen.getByText("Window").nextElementSibling!, { target: { value: "blackman" } });
    type(sibling("Wavelength (Å)"), "1.7889");
    type(sibling("Peak prominence"), "0.2");
    savePreset("Co Kα RQ4");
    fireEvent.change(channel(), { target: { value: "0" } });
    fireEvent.change(screen.getByText("Preprocess").nextElementSibling!, { target: { value: "logR" } });
    type(sibling("Peak prominence"), "0.05");
    pick("Co Kα RQ4");
    press("Apply");
    expect(statusOf(TOOL)).toContain("Applied preset 'Co Kα RQ4' to Reflectivity FFT: press Compute to run it");
    expect(channel().value).toBe("1");
    expect((screen.getByText("Preprocess").nextElementSibling as HTMLSelectElement).value).toBe("RQ4");
    expect(sibling("Peak prominence").value).toBe("0.2");
    expect(reflectivityFft).not.toHaveBeenCalled();
    expect(readLastUsed("reflectivity-fft")).toBeNull();
    press("Revert");
    expect(sibling("Peak prominence").value).toBe("0.05");
    pick("Co Kα RQ4");
    press("Apply");
    press("Compute");
    await waitFor(() => expect(readLastUsed("reflectivity-fft")).not.toBeNull());
    expect(vi.mocked(reflectivityFft).mock.calls[0]?.[0]).toMatchObject({ wavelength_a: 1.7889, preprocess: "RQ4", window: "blackman", peak_prominence_threshold: 0.2 });
    expect(readLastUsed("reflectivity-fft")?.settings).toMatchObject({ column: "Counts", wavelength: 1.7889, preprocess: "RQ4", windowFn: "blackman" });
  });

  it("a wavelength the neutron mode hides never blocks Save; a missing channel is named and skipped", async () => {
    await open("reflectivity-fft", TOOL);
    type(sibling("Wavelength (Å)"), "0"); // shown in X-ray mode: refused
    fireEvent.click(neutron()); // now hidden
    fireEvent.change(channel(), { target: { value: "1" } });
    savePreset("Neutron");
    expect(statusOf(TOOL)).toBe("Saved preset 'Neutron'");
    expect(storedPresets()[0]!.settings).toMatchObject({ isNeutron: true, wavelength: 1.5406 });
    act(() => useApp.setState({ activeId: "d2" }));
    await waitFor(() => expect(channel().value).toBe("0"));
    pick("Neutron");
    press("Apply");
    expect(statusOf(TOOL)).toContain("reflectivity channel skipped (column 'Counts' is not on this sheet)");
    expect(neutron()).toBeChecked(); // the rest applied
  });
});

describe("XRD reference pattern preset bar", () => {
  const TOOL = "XRD reference pattern";
  const axis = () => screen.getByRole("checkbox", { name: /Treat first column/ });
  const file = () => new File(["# wavelength = 1.5406\n2theta,intensity,hkl\n28.44,100,(111)\n32.96,50,(200)\n"], "silicon.csv", { type: "text/csv" });

  it("saves the reading and drawing, Applies them, and the sticks added next carry them; the pattern is not stored", async () => {
    await open("xrd-reference", TOOL);
    const container = document.body;
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file()] } });
    await screen.findByDisplayValue("silicon");
    type(sibling("Vertical offset"), "0.1");
    type(sibling("Maximum height"), "0.4");
    fireEvent.click(screen.getByRole("checkbox", { name: /Show reflection labels/ }));
    fireEvent.click(axis());
    savePreset("Tall labelled");
    type(sibling("Vertical offset"), "0.03");
    type(sibling("Maximum height"), "0.18");
    fireEvent.click(screen.getByRole("checkbox", { name: /Show reflection labels/ }));
    fireEvent.click(axis());
    pick("Tall labelled");
    press("Apply");
    expect(statusOf(TOOL)).toContain("choose the reference file: a preset does not store the pattern");
    await screen.findByDisplayValue("silicon");
    expect(sibling("Vertical offset").value).toBe("0.1");
    expect(sibling("Maximum height").value).toBe("0.4");
    expect(axis()).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Show reflection labels/ })).toBeChecked();
    expect(readLastUsed("xrd-reference")).toBeNull();
    expect(useApp.getState().refLines).toHaveLength(0);
    press("Revert");
    expect(sibling("Vertical offset").value).toBe("0.03");
    pick("Tall labelled");
    press("Apply");
    fireEvent.click(await screen.findByRole("button", { name: /Add 2 reference sticks/ }));
    await waitFor(() => expect(readLastUsed("xrd-reference")).not.toBeNull());
    expect(useApp.getState().refLines[0]).toMatchObject({ stick: { baseline: 0.1, height: 0.4, showLabel: true } });
    expect(readLastUsed("xrd-reference")?.settings).toEqual({ axisMode: "two-theta", baseline: "0.1", height: "0.4", color: "#d97706", showLabels: true });
    expect(Object.keys(storedPresets()[0]!.settings).sort()).toEqual(["axisMode", "baseline", "color", "height", "showLabels"]);
  });

  it("with no pattern loaded the drawing knobs are hidden: Save still works, storing defaults", async () => {
    await open("xrd-reference", TOOL);
    expect(screen.queryByText("Vertical offset")).toBeNull();
    fireEvent.click(axis());
    savePreset("Reading only");
    expect(statusOf(TOOL)).toBe("Saved preset 'Reading only'");
    expect(storedPresets()[0]!.settings).toEqual({ axisMode: "two-theta", baseline: "0.03", height: "0.18", color: "#d97706", showLabels: false });
  });
});
