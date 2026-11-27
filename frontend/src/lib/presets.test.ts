// The generic preset store: read-modify-write over raw records, fail-closed
// versioning (P6, P7), and last used (P3, P4).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkNumberText, checkOneOf, parseFields, type PresetAdapter } from "./presetAdapter";
import { describePresetAdapterContract } from "./presetAdapterContract.testkit";
import { lastUsedSlot, readLastUsed, recordLastUsed } from "./presetLastUsed";
import { PRESETS_KEY, deletePreset, listPresets, renamePreset, resolveSettings, savePreset } from "./presets";

vi.mock("../store/toasts", () => ({ toast: vi.fn() }));
const { toast } = await import("../store/toasts");

interface Toy { size: string; kind: string }
let panelState: Toy = { size: "1", kind: "a" };

/** Schema 2 of a toy tool: schema 1 also had `legacy`, dropped by name, and `mode` renamed to `kind`. */
const toy: PresetAdapter<Toy> = {
  workshop: "toy", label: "Toy", runLabel: "Run", schema: 2,
  migrate: { 1: { dropped: ["legacy"], run: ({ mode, ...rest }) => ({ ...rest, kind: mode }) } },
  defaults: () => ({ size: "10", kind: "a" }),
  parse: (raw) => parseFields<Toy>(raw, { size: checkNumberText((n) => (n > 0 ? null : "must be positive")), kind: checkOneOf(["a", "b"]) }),
  capture: () => ({ ...panelState }),
  apply: (s) => { panelState = { ...s }; return { ok: true, applied: Object.keys(s), skipped: [], notes: [] }; },
  describe: (s) => `${s.kind} ${s.size}`,
};
const other = { ...toy, workshop: "other" };

describePresetAdapterContract({
  adapter: toy,
  sample: { size: "3", kind: "b" },
  wrongType: { field: "size", value: 3 },
  outOfRange: { field: "size", value: "-1" },
  migrations: [{ from: 1, old: { size: "4", mode: "b", legacy: 9 }, expected: { size: "4", kind: "b" }, dropped: ["legacy"] }],
});

const stored = (): { version: number; presets: Record<string, unknown>[] } => JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "null");
const rec = (id: string, settings: object, schema = 2, workshop = "toy") => ({ id, workshop, name: id, schema, settings, createdAt: "t", updatedAt: "t" });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  panelState = { size: "1", kind: "a" };
});

describe("named presets", () => {
  it("saves, lists and updates in place by name (id kept, case-insensitive), per workshop", () => {
    const a = savePreset(toy, "Fast", { size: "5", kind: "b" });
    expect(a).toMatchObject({ ok: true, updated: false });
    const again = savePreset(toy, "  fast ", { size: "6", kind: "a" });
    expect(again).toMatchObject({ ok: true, updated: true, id: a.ok ? a.id : "" });
    const { entries } = listPresets(toy);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: "ok", name: "fast", settings: { size: "6", kind: "a" } });
    expect(listPresets(other).entries).toHaveLength(0);
  });

  it("rejects unsavable settings and bad names", () => {
    expect(savePreset(toy, "x", { size: "-1", kind: "a" })).toMatchObject({ ok: false, reason: expect.stringContaining("'size'") });
    expect(savePreset(toy, "   ", toy.defaults())).toMatchObject({ ok: false });
    expect(savePreset(toy, "n".repeat(65), toy.defaults())).toMatchObject({ ok: false });
    expect(localStorage.getItem(PRESETS_KEY)).toBeNull();
  });

  it("lists an unknown key, a wrong type and an out-of-range value as rejected, naming the field", () => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [
      rec("unknown", { size: "1", kind: "a", foo: 1 }), rec("type", { size: 1, kind: "a" }), rec("range", { size: "-3", kind: "a" }), rec("good", { size: "2", kind: "b" }),
    ] }));
    const by = Object.fromEntries(listPresets(toy).entries.map((e) => [e.name, e]));
    expect(by.unknown).toMatchObject({ state: "rejected", reason: "setting 'foo' is not known to this version" });
    expect(by.type).toMatchObject({ state: "rejected", reason: expect.stringContaining("'size'") });
    expect(by.range).toMatchObject({ state: "rejected", reason: expect.stringContaining("'size'") });
    expect(by.good.state).toBe("ok");
  });

  it("keeps a newer-schema record locked and byte-identical across saves of other presets; it is not renamed or replaced", () => {
    const future = rec("p1:future", { zzz: [1, { a: 2 }] }, 3);
    const alien = rec("p1:alien", { q: 1 }, 9, "elsewhere");
    const junk = { not: "a record" };
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [future, junk, alien] }));
    expect(listPresets(toy).entries[0]).toMatchObject({ state: "locked", reason: "needs a newer version of Quantized" });
    expect(savePreset(toy, "Mine", { size: "2", kind: "a" }).ok).toBe(true);
    const after = stored().presets;
    expect(JSON.stringify(after[0])).toBe(JSON.stringify(future));
    expect(JSON.stringify(after[1])).toBe(JSON.stringify(junk));
    expect(JSON.stringify(after[2])).toBe(JSON.stringify(alien));
    expect(savePreset(toy, "p1:future", toy.defaults())).toMatchObject({ ok: false, reason: expect.stringContaining("locked") });
    expect(renamePreset(toy, "p1:future", "Else")).toMatchObject({ ok: false });
    expect(JSON.stringify(stored().presets[0])).toBe(JSON.stringify(future));
  });

  it("a migration that drops a named field applies the rest and reports the drop; an unnamed extra is rejected", () => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [rec("Old", { size: "7", mode: "b", legacy: true }, 1)] }));
    expect(listPresets(toy).entries[0]).toMatchObject({ state: "ok", settings: { size: "7", kind: "b" }, dropped: ["legacy"] });
    expect(stored().presets[0].schema).toBe(1); // reading never rewrites
    expect(resolveSettings(toy, 1, { size: "7", mode: "b", extra: 1 })).toMatchObject({ state: "rejected", reason: expect.stringContaining("'extra'") });
  });

  it("rename keeps the id; delete removes only that record", () => {
    const a = savePreset(toy, "A", { size: "1", kind: "a" });
    const b = savePreset(toy, "B", { size: "2", kind: "b" });
    if (!a.ok || !b.ok) throw new Error("save failed");
    expect(renamePreset(toy, a.id, "B")).toMatchObject({ ok: false, reason: expect.stringContaining("already exists") });
    expect(renamePreset(toy, a.id, "Renamed")).toMatchObject({ ok: true, id: a.id });
    expect(listPresets(toy).entries.map((e) => [e.id, e.name])).toContainEqual([a.id, "Renamed"]);
    expect(deletePreset(toy, a.id).ok).toBe(true);
    expect(listPresets(toy).entries.map((e) => e.id)).toEqual([b.id]);
    expect(deletePreset(toy, a.id)).toMatchObject({ ok: false });
  });

  it("reports a refused storage write and does not show it as saved", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(savePreset(toy, "Q", toy.defaults())).toMatchObject({ ok: false, reason: expect.stringContaining("refused") });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("preset"), "danger");
    spy.mockRestore();
    expect(listPresets(toy).entries).toHaveLength(0);
  });

  it("never writes over an unreadable or newer file", () => {
    for (const text of ["{not json", JSON.stringify({ version: 2, presets: [] }), JSON.stringify([1])]) {
      localStorage.setItem(PRESETS_KEY, text);
      expect(listPresets(toy).unreadable).toEqual(expect.any(String));
      expect(savePreset(toy, "X", toy.defaults())).toMatchObject({ ok: false });
      expect(localStorage.getItem(PRESETS_KEY)).toBe(text);
    }
  });
});

describe("last used", () => {
  beforeEach(() => lastUsedSlot.reset());

  it("is recorded per workshop, deduplicated, and never overwrites a newer build's entry", () => {
    expect(recordLastUsed(toy, { size: "3", kind: "b" })).toBe(true);
    expect(recordLastUsed(toy, { size: "3", kind: "b" })).toBe(false);
    expect(readLastUsed("toy")).toMatchObject({ schema: 2, settings: { size: "3", kind: "b" } });
    expect(readLastUsed("other")).toBeNull();
    lastUsedSlot.save({ toy: { schema: 5, settings: { future: true }, at: "2099-01-01T00:00:00.000Z" } });
    expect(recordLastUsed(toy, { size: "9", kind: "a" })).toBe(false);
    expect(readLastUsed("toy")?.settings).toEqual({ future: true });
  });

  it("is a pref slot, so Reset all clears it but not the named presets", async () => {
    savePreset(toy, "Keep", toy.defaults());
    recordLastUsed(toy, { size: "3", kind: "b" });
    const { resetAllPrefs } = await import("./prefsReset");
    resetAllPrefs();
    expect(readLastUsed("toy")).toBeNull();
    expect(listPresets(toy).entries).toHaveLength(1);
  });
});
