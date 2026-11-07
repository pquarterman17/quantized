// MAIN_PLAN #42 persistence: named sample profiles and a normalized dataset's
// provenance survive Save -> reopen exactly, through the REAL serializer and
// parser, and the store installs/clears them on load (no cross-project leak).
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { shouldAutosave } from "../useWorkspaceAutosave";
import { emptySampleProfile, makeQuantity, type SavedSampleProfile } from "./sampleGeometry";
import { normalizationProvenance, summarizeNormalization } from "./sampleNormalization";
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
  it("reproduces the recorded factor from the reopened profile", () => {
    const summary = summarizeNormalization(profile, "volume", "emu", "A/m");
    const provenance = normalizationProvenance({
      profile, summary, toField: "T",
      record: {
        factor: summary.factor!, divisor: summary.divisor!, divisor_unit: "cm³", mass_g: null,
        area_cm2: summary.areaCm2, volume_cm3: summary.volumeCm3,
        canonical: { width: 5, length: 5, film_thickness: 3e-6 }, equation: summary.equation, geometry_equation: summary.geometryEquation,
      },
      source: { datasetId: "d0", datasetName: "film.dat", channel: "Moment", xUnit: "Oe" },
    });
    const derived = { ...ds, data: { ...ds.data, metadata: { magnetometry_normalization: provenance } } };
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [derived] })).datasets[0];
    const rec = reopened.data.metadata.magnetometry_normalization as typeof provenance & { profile: typeof profile; factor: number };
    expect(rec).toEqual(provenance);
    expect(summarizeNormalization(rec.profile, "volume", "emu", "A/m").factor).toBe(rec.factor);
  });
});
