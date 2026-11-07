// MAIN_PLAN #42 persistence: named sample profiles and a normalized dataset's
// provenance survive Save -> reopen exactly, through the REAL serializer and
// parser, and the store installs/clears them on load (no cross-project leak).
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { shouldAutosave } from "../useWorkspaceAutosave";
import { emptySampleProfile, makeQuantity, type SavedSampleProfile } from "./sampleGeometry";
import { normalizationProvenance } from "./normalizationProvenance";
import { summarizeNormalization } from "./sampleNormalization";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const profile = {
  ...emptySampleProfile(),
  width: makeQuantity("width", 5, "cm"),
  length: makeQuantity("length", 50, "mm"),
  filmThickness: makeQuantity("filmThickness", 30, "nm"),
};
const saved: SavedSampleProfile[] = [{ id: "sprof-1", name: "Film A", savedAt: "2026-11-07T12:00:00.000Z", profile }];

const ds: Dataset = {
  id: "d1",
  name: "film (A/m)",
  data: { time: [0, 1], values: [[1], [2]], labels: ["Moment"], units: ["A/m"], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ savedSampleProfiles: [] });
});

describe("saved sample profiles in the .dwk", () => {
  it("round-trip exactly, entered units and canonical values included", () => {
    const loaded = parseWorkspace(serializeWorkspace({ datasets: [ds], savedSampleProfiles: saved }));
    expect(loaded.savedSampleProfiles).toEqual(saved);
    expect(loaded.savedSampleProfiles![0].profile.length).toEqual({ value: 50, unit: "mm", canonical: 5 });
  });

  it("are omitted when empty, so an ordinary project's file does not change", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds], savedSampleProfiles: [] })) as Record<string, unknown>;
    expect("savedSampleProfiles" in doc).toBe(false);
    expect(parseWorkspace(JSON.stringify(doc)).savedSampleProfiles).toEqual([]);
  });

  it("drop malformed or future-version entries on load", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds], savedSampleProfiles: saved })) as Record<string, unknown>;
    doc.savedSampleProfiles = [...saved, { id: "x", name: "future", profile: { ...profile, version: 99 } }, 3];
    expect(parseWorkspace(JSON.stringify(doc)).savedSampleProfiles).toEqual(saved);
  });

  it("are installed by loadWorkspace and cleared by a project without them", () => {
    useApp.getState().loadWorkspace({ datasets: [ds], savedSampleProfiles: saved });
    expect(useApp.getState().savedSampleProfiles).toEqual(saved);
    useApp.getState().loadWorkspace({ datasets: [ds] });
    expect(useApp.getState().savedSampleProfiles).toEqual([]);
  });

  it("a profile edit schedules an autosave", () => {
    const state = useApp.getState();
    expect(shouldAutosave({ ...state, savedSampleProfiles: saved }, state)).toBe(true);
  });
});

describe("normalization provenance survives save and reopen", () => {
  it("reopens equal, and the reopened profile alone gives the HAND-COMPUTED factor", () => {
    // Profile: 5 cm × 50 mm × 30 nm. A = 5 cm × 5 cm = 25 cm²; t = 3e-6 cm;
    // V = 7.5e-5 cm³. 1 emu/cm³ = 1000 A/m, so emu -> A/m is ×1000 / 7.5e-5
    // = 1.3333…e7. This number is written by hand, never read back from the
    // summary under test.
    const HAND_FACTOR = 1000 / 7.5e-5;
    const summary = summarizeNormalization(profile, "volume", "emu", "A/m");
    const provenance = normalizationProvenance({
      profile, summary, toField: "T",
      record: {
        factor: HAND_FACTOR, divisor: 7.5e-5, divisor_unit: "cm³", mass_g: null, area_cm2: 25, volume_cm3: 7.5e-5,
        canonical: { width: 5, length: 5, film_thickness: 3e-6 }, equation: "M [A/m] = m [emu] × 1000 / V [cm³]", geometry_equation: "g",
      },
      source: { datasetId: "d0", datasetName: "film.dat", xKey: null, yKey: 0, channel: "Moment", xUnit: "Oe" },
    });
    const derived = { ...ds, data: { ...ds.data, metadata: { magnetometry_normalization: provenance } } };
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [derived] })).datasets[0];
    const rec = reopened.data.metadata.magnetometry_normalization as typeof provenance & { profile: typeof profile; factor: number };
    expect(rec).toEqual(provenance);
    expect(rec.factor).toBe(HAND_FACTOR);
    // Recompute from the reopened record alone (the entered values + units).
    const recomputed = summarizeNormalization(rec.profile, "volume", "emu", "A/m").factor!;
    expect(Math.abs(recomputed / HAND_FACTOR - 1)).toBeLessThan(1e-12);
  });
});
