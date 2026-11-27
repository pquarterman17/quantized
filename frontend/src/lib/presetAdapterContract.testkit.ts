// The adapter contract (plans/PRESET_BAR_CONTRACT.md section 6): every
// workshop's `presetAdapter.test.ts` calls `describePresetAdapterContract`, so
// rollout is mechanical and a drifting `capture` / `apply` pair fails here.
// Test-only: never imported by app code.

import { describe, expect, it } from "vitest";

import { canonicalJson, type PresetAdapter } from "./presetAdapter";
import { resolveSettings } from "./presets";

export interface ContractFixtures<S extends object> {
  adapter: PresetAdapter<S>;
  /** Valid settings that differ from the defaults in every field the panel can hold. */
  sample: S;
  /** A field with a wrong-typed value, and (optionally) one with an out-of-range value. */
  wrongType: { field: keyof S & string; value: unknown };
  outOfRange?: { field: keyof S & string; value: unknown };
  /** One entry per migration step: an old record and what it must become. */
  migrations?: { from: number; old: unknown; expected: S; dropped?: string[] }[];
  /** For an adapter with `columnFields`: settings naming a column the sheet lacks. */
  missingColumn?: { settings: S; field: keyof S & string; labels: readonly string[]; required: boolean };
}

// Deep and key-order independent: nested settings (a parameter table) must be compared, not blanked.
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

export function describePresetAdapterContract<S extends object>(fx: ContractFixtures<S>): void {
  const { adapter, sample } = fx;
  describe(`preset adapter contract: ${adapter.workshop}`, () => {
    it("defaults() parses and describe() says something", () => {
      const parsed = adapter.parse(adapter.defaults());
      expect("error" in parsed && Object.keys(parsed).length === 1 ? parsed : null).toBeNull();
      expect(adapter.describe(sample).length).toBeGreaterThan(0);
    });

    it("apply then capture returns the same settings, and apply reports every field", () => {
      const out = adapter.apply(sample);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.applied.sort()).toEqual(Object.keys(sample).sort());
      expect(same(adapter.capture(), sample)).toBe(true);
    });

    it("rejects an unknown key, naming it", () => {
      const r = adapter.parse({ ...sample, bogusSetting: 1 });
      expect(r).toEqual({ error: expect.stringContaining("'bogusSetting'") });
    });

    it("rejects a missing key, naming it", () => {
      for (const key of Object.keys(sample)) {
        const { [key as keyof S]: _gone, ...rest } = sample;
        void _gone;
        expect(adapter.parse(rest)).toEqual({ error: expect.stringContaining(`'${key}'`) });
      }
    });

    it("rejects a wrong type, and an out-of-range value, naming the field", () => {
      const bad = [fx.wrongType, ...(fx.outOfRange ? [fx.outOfRange] : [])];
      for (const { field, value } of bad) {
        expect(adapter.parse({ ...sample, [field]: value })).toEqual({ error: expect.stringContaining(`'${field}'`) });
      }
    });

    it("locks a record from a newer schema and never applies it", () => {
      const r = resolveSettings(adapter, adapter.schema + 1, sample);
      expect(r).toMatchObject({ state: "locked", reason: expect.stringContaining("newer version") });
    });

    it("accepts the current schema", () => {
      expect(resolveSettings(adapter, adapter.schema, sample)).toMatchObject({ state: "ok" });
    });

    for (const m of fx.migrations ?? []) {
      it(`migrates schema ${m.from} to the current schema`, () => {
        const r = resolveSettings(adapter, m.from, m.old);
        expect(r.state).toBe("ok");
        if (r.state === "ok") {
          expect(same(r.settings, m.expected)).toBe(true);
          expect(r.dropped).toEqual(m.dropped ?? []);
        }
      });
    }
    if (adapter.schema > 1) {
      it("locks a record whose upgrade path has a missing step", () => {
        const gap = { ...adapter, migrate: {} };
        expect(resolveSettings(gap, 1, sample)).toMatchObject({ state: "locked", reason: expect.stringContaining("cannot be upgraded from schema 1") });
      });
    }

    if (fx.missingColumn) {
      const mc = fx.missingColumn;
      it(`a missing column label ${mc.required ? "refuses" : "skips"} as declared`, async () => {
        const { planColumnFields } = await import("./presetAdapter");
        const plan = planColumnFields(adapter, mc.settings, mc.labels);
        if (mc.required) expect(plan).toEqual({ refuse: expect.stringContaining("is not on this sheet") });
        else expect(plan).toEqual({ skipped: [{ field: mc.field, reason: expect.stringContaining("is not on this sheet") }] });
      });
    }
  });
}
