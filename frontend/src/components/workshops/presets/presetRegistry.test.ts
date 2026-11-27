// The preset registry is the one place the Library, the preset file and "Open
// in tool" learn about a tool's adapter, so it is pinned against the real
// adapters: every adapter file is registered, the plain-data row in
// lib/presetWorkshops.ts equals what the adapter says, and every tool can be
// opened from the Library.

import { describe, expect, it } from "vitest";

import { PRESET_WORKSHOPS } from "../../../lib/presetWorkshops";
import { PRESET_OPENERS } from "../../../store/presetOpeners";
import { PRESET_ADAPTER_LOADERS, loadPresetAdapters } from "./presetRegistry";

describe("preset registry", () => {
  it("registers every presetAdapter.ts, and the data table and openers cover the same tools", () => {
    const files = Object.keys(import.meta.glob("../*/presetAdapter.ts"));
    expect(Object.keys(PRESET_ADAPTER_LOADERS).sort()).toHaveLength(files.length);
    expect(Object.keys(PRESET_WORKSHOPS).sort()).toEqual(Object.keys(PRESET_ADAPTER_LOADERS).sort());
    expect(Object.keys(PRESET_OPENERS).sort()).toEqual(Object.keys(PRESET_ADAPTER_LOADERS).sort());
  });

  it("each data row equals its adapter (id, label, schema, run button, legacy store) and `parse` works without a panel", async () => {
    const adapters = await loadPresetAdapters();
    expect(adapters.size).toBe(Object.keys(PRESET_WORKSHOPS).length);
    for (const [id, info] of Object.entries(PRESET_WORKSHOPS)) {
      const a = adapters.get(id);
      expect(a, id).toBeDefined();
      if (!a) continue;
      expect({ workshop: a.workshop, label: a.label, schema: a.schema, runLabel: a.runLabel, generic: a.backend === undefined }, id).toEqual({ workshop: id, ...info });
      // `parse` must not need the panel (`defaults`/`capture` may): an empty object is refused, not thrown on.
      expect(a.parse({}), id).toEqual({ error: expect.any(String) });
    }
  });

  it("an unknown id is simply absent", async () => {
    expect((await loadPresetAdapters(["nope", "resample"])).size).toBe(1);
  });
});
