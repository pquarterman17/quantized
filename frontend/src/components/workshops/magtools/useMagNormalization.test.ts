// Units tab hook (MAIN_PLAN #42): explicit basis, unit-preserving edits,
// per-field validation, non-destructive Apply with full provenance, the
// explicit metadata fill, and saved profiles. Also the source-unit and gap
// contracts the old Units tab established (formerly useMagTools.units.test.ts).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeMagMoment } from "../../../lib/api/magnetometry";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMagNormalization } from "./useMagNormalization";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
  normalizeMagMoment: vi.fn(),
  demagCorrectField: vi.fn(),
}));

const realResolveDataset = useApp.getState().resolveDataset;

const curve = (xName: string, xUnit: string, yUnit = "emu", metadata: Record<string, unknown> = {}): DataStruct => ({
  time: [-1000, 0, 1000],
  values: [[-1.5e-3], [0], [1.5e-3]],
  labels: ["Moment"],
  units: [yUnit],
  metadata: { x_column_name: xName, x_column_unit: xUnit, ...metadata },
});

type Body = Parameters<typeof normalizeMagMoment>[0];

/** A faithful-enough stand-in for the backend: the factor is the one the
 *  frontend summary computes independently in lib/sampleNormalization.ts's
 *  own tests; here only the plumbing is under test. */
function fakeBackend(factor: number, divisor = 1) {
  return async (b: Body) => ({
    x: b.x, y: b.y.map((v) => v * factor), x_unit: b.to_field, y_unit: b.to_moment, warning: "",
    basis: b.basis, geometry: b.geometry, factor, divisor, divisor_unit: b.basis === "none" ? "" : "cm³",
    mass_g: null, area_cm2: 25, volume_cm3: 7.5e-5,
    canonical: { width: 5, length: 5, film_thickness: 3e-6 }, equation: "eq", geometry_equation: "geq",
  });
}

function load(data: DataStruct, name = "film.dat"): void {
  useApp.setState({
    datasets: [{ id: "d1", name, data }], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    status: "", savedSampleProfiles: [], resolveDataset: realResolveDataset,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(normalizeMagMoment).mockImplementation(fakeBackend(1));
  load(curve("Magnetic Field", "Oe"));
});

function enterFilm(result: { current: ReturnType<typeof useMagNormalization> }): void {
  act(() => result.current.setBasis("volume"));
  act(() => result.current.setGeometry("rectangle"));
  act(() => result.current.setFieldText("width", "5"));
  act(() => result.current.setFieldText("length", "5"));
  act(() => result.current.setFieldText("filmThickness", "30"));
}

describe("useMagNormalization — explicit basis and units", () => {
  it("starts at the raw basis and never picks one from metadata", () => {
    load(curve("Magnetic Field", "Oe", "emu", { instrument: { SAMPLE_MASS: "7.2" } }));
    const { result } = renderHook(() => useMagNormalization());
    expect(result.current.basis).toBe("none");
    act(() => result.current.fillFromMetadata());
    expect(result.current.basis).toBe("none");
    expect(result.current.profile.mass).toMatchObject({ value: 7.2, unit: "mg" });
  });

  it("offers only the selected basis's output units and follows a basis change", () => {
    const { result } = renderHook(() => useMagNormalization());
    expect(result.current.outputUnits).toEqual(["emu", "A·m²"]);
    act(() => result.current.setBasis("volume"));
    expect(result.current.outputUnits).toEqual(["emu/cm³", "A/m", "kA/m"]);
    expect(result.current.toMoment).toBe("emu/cm³");
    act(() => result.current.setToMoment("A/m"));
    act(() => result.current.setBasis("area"));
    expect(result.current.toMoment).toBe("emu/cm²"); // never a volume unit under area
  });

  it("a unit change keeps the physical value", () => {
    const { result } = renderHook(() => useMagNormalization());
    enterFilm(result);
    const before = result.current.summary.volumeCm3;
    act(() => result.current.setFieldUnit("filmThickness", "Å"));
    expect(result.current.texts.filmThickness).toBe("300");
    act(() => result.current.setFieldUnit("width", "mm"));
    expect(result.current.texts.width).toBe("50");
    expect(result.current.summary.volumeCm3).toBeCloseTo(before!, 18);
  });

  it("keeps the summary live and names the exact field that blocks Apply", () => {
    const { result } = renderHook(() => useMagNormalization());
    enterFilm(result);
    expect(result.current.applyBlocked).toBeNull();
    expect(result.current.summary.volumeCm3).toBeCloseTo(7.5e-5, 18);
    act(() => result.current.setFieldText("filmThickness", "-3"));
    expect(result.current.applyBlocked).toBe("Magnetic-film thickness must be greater than zero.");
    expect(result.current.summary.fieldErrors).toEqual({ filmThickness: "Magnetic-film thickness must be greater than zero." });
    act(() => result.current.setFieldText("filmThickness", "abc"));
    expect(result.current.applyBlocked).toBe("Magnetic-film thickness must be a number.");
    act(() => result.current.setFieldText("filmThickness", ""));
    expect(result.current.applyBlocked).toBe("Magnetic-film thickness is required.");
  });

  it("an area basis drops a direct-volume geometry instead of keeping an impossible path", () => {
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setBasis("volume"));
    act(() => result.current.setGeometry("volume"));
    act(() => result.current.setBasis("area"));
    expect(result.current.profile.geometry).toBe("rectangle");
  });

  it("keeps the source field unit by default and refuses a no-op", () => {
    const { result } = renderHook(() => useMagNormalization());
    expect(result.current.toField).toBe("Oe");
    expect(result.current.applyBlocked).toMatch(/Nothing to change/);
    act(() => result.current.setToField("T"));
    expect(result.current.applyBlocked).toBeNull();
  });
});

describe("useMagNormalization — Apply is non-destructive and fully recorded", () => {
  it("5 cm × 5 cm × 30 nm -> A/m writes a NEW dataset with complete provenance", async () => {
    const source = useApp.getState().datasets[0];
    vi.mocked(normalizeMagMoment).mockImplementation(fakeBackend(1000 / 7.5e-5, 7.5e-5));
    const { result } = renderHook(() => useMagNormalization());
    enterFilm(result);
    act(() => result.current.setToMoment("A/m"));
    await act(async () => { await result.current.apply(); });

    const body = vi.mocked(normalizeMagMoment).mock.calls[0][0];
    // The field axis is left in its own unit unless the user asks otherwise.
    expect(body).toMatchObject({ basis: "volume", to_moment: "A/m", geometry: "rectangle", from_moment: "emu", from_field: "Oe", to_field: "Oe" });
    expect(body.profile.film_thickness).toEqual({ value: 30, unit: "nm" });
    const [orig, out] = useApp.getState().datasets;
    expect(orig).toBe(source); // the imported dataset is untouched
    expect(orig.data.values).toEqual([[-1.5e-3], [0], [1.5e-3]]);
    expect(out.data.units).toEqual(["A/m"]);
    expect(out.data.values[2][0]).toBeCloseTo(20_000, 6);
    const prov = out.data.metadata.magnetometry_normalization as Record<string, unknown>;
    expect(prov).toMatchObject({
      version: 1, basis: "volume", geometry: "rectangle", from_moment: "emu", to_moment: "A/m",
      from_field: "Oe", to_field: "Oe", divisor: 7.5e-5, divisor_unit: "cm³", sample_volume_cm3: 7.5e-5,
      source_dataset_id: "d1", source_dataset_name: "film.dat", source_channel: "Moment",
    });
    expect(prov.inputs).toMatchObject({ film_thickness: { value: 30, unit: "nm", canonical: 3e-6, canonical_unit: "cm" } });
    expect((prov.profile as { filmThickness: unknown }).filmThickness).toEqual({ value: 30, unit: "nm", canonical: expect.closeTo(3e-6, 18) });
  });

  it("refuses before the request when a field is invalid, even if called directly", async () => {
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setBasis("mass"));
    await act(async () => { await result.current.apply(); });
    expect(normalizeMagMoment).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Sample mass is required.");
  });

  it("refuses to divide an already-normalized moment again", async () => {
    load(curve("Magnetic Field", "Oe", "emu/g"));
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setBasis("mass"));
    act(() => result.current.setFieldText("mass", "2"));
    expect(result.current.applyBlocked).toMatch(/already in emu\/g/);
  });

  it("preserves an earlier normalization record when only the field unit changes", async () => {
    const provenance = { basis: "mass", to_moment: "emu/g", sample_mass_g: 0.002 };
    load(curve("Magnetic Field", "Oe", "emu/g", { magnetometry_normalization: provenance }));
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setToField("T"));
    await act(async () => { await result.current.apply(); });
    expect(useApp.getState().datasets[1].data.metadata.magnetometry_normalization).toEqual(provenance);
  });

  it("never converts a temperature axis as a field", async () => {
    load(curve("Temperature", "K"));
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setToMoment("A·m²"));
    await act(async () => { await result.current.apply(); });
    const body = vi.mocked(normalizeMagMoment).mock.calls[0][0];
    expect([body.from_field, body.to_field]).toEqual(["K", "K"]);
    expect(result.current.warning).toContain("not a field");
  });

  it("offers a source field unit outside the standard list instead of misreporting it", () => {
    load(curve("Magnetic Field", "kOe"));
    const { result } = renderHook(() => useMagNormalization());
    expect(result.current.fieldUnits[0]).toBe("kOe");
    expect(result.current.toField).toBe("kOe");
  });

  it("sends the moment channel's own unit", async () => {
    load(curve("Magnetic Field", "T", "A·m²"));
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setToField("mT"));
    act(() => result.current.setToMoment("emu"));
    await act(async () => { await result.current.apply(); });
    expect(vi.mocked(normalizeMagMoment).mock.calls[0][0]).toMatchObject({ from_moment: "A·m²", from_field: "T", to_field: "mT" });
  });

  it("sends no null and keeps a good field value on a moment-gap row", async () => {
    load({ ...curve("Magnetic Field", "Oe"), values: [[5], [Number.NaN], [1]] });
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setToField("T"));
    await act(async () => { await result.current.apply(); });
    const body = vi.mocked(normalizeMagMoment).mock.calls[0][0];
    expect(body.x).toEqual([-1000, 0, 1000]);
    expect(body.y).toEqual([5, 0, 1]);
    expect(JSON.stringify(body.y)).not.toContain("null");
    const out = useApp.getState().datasets[1].data;
    expect(Number.isNaN(out.values[1][0])).toBe(true);
    expect(out.values[2]).toEqual([1]);
  });

  it("refuses an all-gap series instead of minting an all-NaN dataset", async () => {
    load({ ...curve("Magnetic Field", "Oe"), time: [Number.NaN, Number.NaN], values: [[Number.NaN], [Number.NaN]] });
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setToField("T"));
    await act(async () => { await result.current.apply(); });
    expect(normalizeMagMoment).not.toHaveBeenCalled();
    expect(result.current.error).toContain("No finite field or moment values");
  });

  it("abandons an in-flight apply when the same source is replaced", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    vi.mocked(normalizeMagMoment).mockImplementationOnce(async (b) => { signalStarted(); await gate; return fakeBackend(1)(b); });
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setToField("T"));
    let run!: Promise<void>;
    act(() => { run = result.current.apply(); });
    await started;
    const source = useApp.getState().datasets[0];
    act(() => useApp.setState({ datasets: [{ ...source, data: { ...source.data, values: [[9], [9], [9]] } }] }));
    await act(async () => { finish(); await run; });
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("abandons a lazy apply when the selected dataset changes", async () => {
    const other: Dataset = { id: "b", name: "b.dat", data: curve("Temperature", "K") };
    let release!: (d: Dataset | undefined) => void;
    const pending = new Promise<Dataset | undefined>((resolve) => { release = resolve; });
    const source = useApp.getState().datasets[0];
    useApp.setState({ datasets: [source, other], resolveDataset: vi.fn(() => pending) });
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setToField("T"));
    let run!: Promise<void>;
    act(() => { run = result.current.apply(); });
    act(() => useApp.setState({ activeId: "b" }));
    await act(async () => { release(source); await run; });
    expect(normalizeMagMoment).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(2);
  });
});

describe("useMagNormalization — metadata fill and saved profiles are explicit", () => {
  it("fills only stated fields, keeps the rest, and touches no plot or dataset state", () => {
    load(curve("Magnetic Field", "Oe", "emu", { instrument: { SAMPLE_MASS: "7.2" } }));
    useApp.setState({ xKey: null, yKeys: [0] });
    const before = useApp.getState().datasets[0];
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.setFieldText("width", "4"));
    act(() => result.current.fillFromMetadata());
    expect(result.current.texts.mass).toBe("7.2");
    expect(result.current.texts.width).toBe("4");
    expect(result.current.notice).toMatch(/SAMPLE_MASS/);
    expect(useApp.getState().datasets[0]).toBe(before);
    expect(useApp.getState().yKeys).toEqual([0]);
  });

  it("says so when the metadata states nothing", () => {
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.fillFromMetadata());
    expect(result.current.error).toMatch(/states no sample mass or geometry/);
  });

  it("saves a named profile, loads it into the form for another dataset, and never applies it", () => {
    const { result } = renderHook(() => useMagNormalization());
    enterFilm(result);
    act(() => result.current.saveProfile("Film A"));
    const saved = useApp.getState().savedSampleProfiles;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: "Film A", profile: { filmThickness: { value: 30, unit: "nm" } } });

    const other: Dataset = { id: "d2", name: "film2.dat", data: curve("Magnetic Field", "Oe") };
    act(() => useApp.setState({ datasets: [...useApp.getState().datasets, other], activeId: "d2" }));
    const fresh = renderHook(() => useMagNormalization());
    expect(fresh.result.current.texts.width).toBe(""); // nothing auto-applied on a new dataset
    act(() => fresh.result.current.loadProfile(saved[0].id));
    expect(fresh.result.current.texts.filmThickness).toBe("30");
    expect(fresh.result.current.basis).toBe("none"); // loading never picks a basis
    expect(normalizeMagMoment).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("dedupes a repeated name instead of replacing, and delete is undoable", () => {
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.saveProfile("Film A"));
    act(() => result.current.saveProfile("Film A"));
    const names = useApp.getState().savedSampleProfiles.map((p) => p.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    act(() => result.current.profiles.remove(useApp.getState().savedSampleProfiles[0].id));
    expect(useApp.getState().savedSampleProfiles).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(useApp.getState().savedSampleProfiles).toHaveLength(2);
  });

  it("a blank name is refused with a message", () => {
    const { result } = renderHook(() => useMagNormalization());
    act(() => result.current.saveProfile("   "));
    expect(useApp.getState().savedSampleProfiles).toHaveLength(0);
    expect(result.current.error).toMatch(/Name the profile/);
  });
});
