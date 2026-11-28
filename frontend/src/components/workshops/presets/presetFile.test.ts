// Export and import of presets (item 40 slice P5), through the real adapters
// and the real stores: round trip, the "(imported)" merge rule, a malformed
// file importing nothing, newer schemas kept locked, unknown fields rejected
// with the field named, unknown tools named, and legacy-store tools (Curve Fit)
// importing through their own backend.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { describeImport, exportPresets, importPresetFile, parsePresetFile, type ImportResult } from "../../../lib/presetFile";
import { PRESETS_KEY, genericBackend, listPresets, savePreset } from "../../../lib/presets";
import { TEMPLATES_KEY } from "../../../lib/templateKey";
import { loadPresetAdapters } from "./presetRegistry";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const RESAMPLE = { mode: "n_points", nPoints: "77", step: "", start: "", stop: "", rangeStep: "", method: "pchip", outOfRange: "nan", sortUnsorted: false };
const OUTLIER = { method: "mad", threshold: 4, alpha: 0.05, k: 2 };
const FIT = { model: "Gaussian", weight: "poisson", manualLabel: "", scaleErrors: true, rows: [], range: null };

const adapters = await loadPresetAdapters();
const resample = adapters.get("resample")!;
const outlier = adapters.get("outlier-screening")!;
const curvefit = adapters.get("curvefit")!;

const entry = (workshop: string, name: string, settings: object, schema = 1) => ({ workshop, name, schema, settings, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
const file = (presets: unknown[], over: object = {}) => JSON.stringify({ kind: "qz-presets", version: 1, exportedAt: "2026-01-03T00:00:00.000Z", presets, ...over });
const imp = (text: string): Promise<ImportResult> => importPresetFile(text, (ids) => loadPresetAdapters(ids));
const stored = (): { id: string; workshop: string; name: string; schema: number; settings: Record<string, unknown> }[] =>
  JSON.parse(localStorage.getItem(PRESETS_KEY) ?? `{"presets":[]}`).presets;
const names = (workshop: string) => stored().filter((r) => r.workshop === workshop).map((r) => r.name).sort();

beforeEach(() => localStorage.clear());

describe("export", () => {
  it("writes a versioned, settings-only file with each preset's schema and no ids", () => {
    savePreset(resample, "Dense", RESAMPLE);
    savePreset(outlier, "MAD 4", OUTLIER);
    const out = exportPresets(adapters, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = JSON.parse(out.text);
    expect(body).toMatchObject({ kind: "qz-presets", version: 1 });
    expect(body.presets).toHaveLength(2);
    for (const p of body.presets) {
      expect(Object.keys(p).sort()).toEqual(["createdAt", "name", "schema", "settings", "updatedAt", "workshop"]);
      expect(p.schema).toBe(1);
    }
    expect(out.text).not.toMatch(/"id"/);
    expect(out.text).not.toMatch(/matchId/);
  });

  it("exports one tool's presets only", () => {
    savePreset(resample, "Dense", RESAMPLE);
    savePreset(outlier, "MAD 4", OUTLIER);
    const out = exportPresets(new Map([["resample", resample]]), "resample");
    const body = out.ok ? (JSON.parse(out.text) as { presets: { name: string }[] }) : null;
    expect(body?.presets.map((p) => p.name)).toEqual(["Dense"]);
  });

  it("says so when there is nothing to export, and when the stored file is unreadable", () => {
    expect(exportPresets(adapters, null)).toEqual({ ok: false, reason: "there are no presets to export" });
    localStorage.setItem(PRESETS_KEY, "{not json");
    expect(exportPresets(adapters, null)).toMatchObject({ ok: false, reason: expect.stringContaining("left untouched") });
  });

  it("exports a Curve Fit preset from its fit-template store", () => {
    curvefit.backend!.save("Peak fit", FIT as never);
    const out = exportPresets(adapters, "curvefit");
    expect(out.ok && JSON.parse(out.text).presets).toEqual([expect.objectContaining({ workshop: "curvefit", name: "Peak fit", settings: FIT })]);
  });
});

describe("round trip", () => {
  it("export, clear, import restores every preset with the same settings, and reports the counts", async () => {
    savePreset(resample, "Dense", RESAMPLE);
    savePreset(outlier, "MAD 4", OUTLIER);
    curvefit.backend!.save("Peak fit", FIT as never);
    const out = exportPresets(adapters, null);
    if (!out.ok) throw new Error(out.reason);
    localStorage.clear();
    const r = await imp(out.text);
    expect(r).toMatchObject({ ok: true, imported: 3, locked: 0, skipped: [], renamed: [] });
    expect(listPresets(resample).entries).toMatchObject([{ state: "ok", name: "Dense", settings: RESAMPLE }]);
    expect(listPresets(outlier).entries).toMatchObject([{ state: "ok", name: "MAD 4", settings: OUTLIER }]);
    expect(curvefit.backend!.list().entries).toMatchObject([{ state: "ok", name: "Peak fit", settings: FIT }]);
    expect(describeImport(r)).toBe("Imported 3 presets, 0 skipped");
  });
});

describe("name clashes", () => {
  it("never overwrite: a clashing name becomes '(imported)', then '(imported 2)'", async () => {
    savePreset(resample, "Dense", { ...RESAMPLE, nPoints: "11" });
    const r = await imp(file([entry("resample", "dense", RESAMPLE), entry("resample", "Dense", RESAMPLE), entry("resample", "Fresh", RESAMPLE)]));
    expect(r).toMatchObject({ ok: true, imported: 3 });
    expect(names("resample")).toEqual(["Dense", "Dense (imported 2)", "Fresh", "dense (imported)"]);
    // The original is untouched.
    expect(stored().find((x) => x.name === "Dense")!.settings.nPoints).toBe("11");
    if (r.ok) expect(r.renamed.map((x) => x.to).sort()).toEqual(["Dense (imported 2)", "dense (imported)"]);
  });

  it("an imported name stays within the 64 character limit", async () => {
    const long = "x".repeat(64);
    savePreset(resample, long, RESAMPLE);
    await imp(file([entry("resample", long, { ...RESAMPLE, nPoints: "12" })]));
    const got = names("resample").find((n) => n !== long)!;
    expect(got).toHaveLength(64);
    expect(got.endsWith(" (imported)")).toBe(true);
  });

  it("a legacy-store tool renames on a clash too, and does not overwrite the fit template", async () => {
    curvefit.backend!.save("Peak fit", { ...FIT, model: "Linear" } as never);
    const r = await imp(file([entry("curvefit", "Peak fit", FIT)]));
    expect(r).toMatchObject({ ok: true, imported: 1, renamed: [{ from: "Peak fit", to: "Peak fit (imported)" }] });
    const e = curvefit.backend!.list().entries;
    expect(e.map((x) => x.name).sort()).toEqual(["Peak fit", "Peak fit (imported)"]);
    expect(e.find((x) => x.name === "Peak fit")).toMatchObject({ settings: { model: "Linear" } });
    expect(localStorage.getItem(TEMPLATES_KEY)).toBeTruthy();
  });
});

describe("importing the same preset again", () => {
  it("skips a preset identical in content to a stored one, whatever either is called, and names it", async () => {
    savePreset(resample, "Dense", RESAMPLE);
    const text = file([entry("resample", "Dense", RESAMPLE), entry("resample", "Other name, same settings", RESAMPLE)]);
    const r = await imp(text);
    expect(r).toMatchObject({ ok: true, imported: 0, renamed: [], skipped: [
      { workshop: "resample", name: "Dense", reason: "already present as 'Dense'" },
      { workshop: "resample", name: "Other name, same settings", reason: "already present as 'Dense'" },
    ] });
    expect(names("resample")).toEqual(["Dense"]);
    if (r.ok) expect(describeImport(r)).toContain("already present as 'Dense'");
  });

  it("a different preset with the same name still gets '(imported)', and importing that file again adds nothing", async () => {
    savePreset(resample, "Dense", { ...RESAMPLE, nPoints: "11" });
    const text = file([entry("resample", "Dense", RESAMPLE)]);
    expect(await imp(text)).toMatchObject({ ok: true, imported: 1, renamed: [{ from: "Dense", to: "Dense (imported)" }] });
    expect(await imp(text)).toMatchObject({ ok: true, imported: 0, renamed: [], skipped: [{ reason: "already present as 'Dense (imported)'" }] });
    expect(names("resample")).toEqual(["Dense", "Dense (imported)"]);
  });

  it("a legacy-store tool skips an identical preset too", async () => {
    curvefit.backend!.save("Peak fit", FIT as never);
    const r = await imp(file([entry("curvefit", "Peak fit", FIT), entry("curvefit", "Copy", FIT)]));
    expect(r).toMatchObject({ ok: true, imported: 0, renamed: [], skipped: [{ reason: "already present as 'Peak fit'" }, { reason: "already present as 'Peak fit'" }] });
    expect(curvefit.backend!.list().entries).toHaveLength(1);
  });

  it("a newer-schema (locked) preset already stored is not stored twice", async () => {
    const text = file([entry("resample", "Future", { nPoints: "5", wibble: true }, 2)]);
    expect(await imp(text)).toMatchObject({ ok: true, locked: 1 });
    expect(await imp(text)).toMatchObject({ ok: true, locked: 0, skipped: [{ reason: "already present as 'Future'" }] });
    expect(names("resample")).toEqual(["Future"]);
  });
});

describe("a malformed file imports nothing", () => {
  const cases: [string, string, string][] = [
    ["not JSON", "{oops", "not valid JSON"],
    ["not an object", "[1,2]", "not a Quantized preset file"],
    ["another kind", JSON.stringify({ kind: "something", version: 1, presets: [] }), "not a Quantized preset file"],
    ["a newer file version", file([], { version: 2 }), "newer version"],
    ["an unknown file version", file([], { version: "x" }), "version"],
    ["no list", JSON.stringify({ kind: "qz-presets", version: 1 }), "no presets list"],
    ["one bad entry among good ones", file([entry("resample", "Good", RESAMPLE), { workshop: "resample", name: "Bad" }]), "preset 2 is malformed"],
    ["a non-integer schema", file([entry("resample", "X", RESAMPLE, 1.5)]), "preset 1 is malformed"],
  ];
  for (const [label, text, why] of cases) {
    it(label, async () => {
      savePreset(resample, "Existing", RESAMPLE);
      const before = localStorage.getItem(PRESETS_KEY);
      const r = await imp(text);
      expect(r).toMatchObject({ ok: false, reason: expect.stringContaining(why) });
      expect(localStorage.getItem(PRESETS_KEY)).toBe(before);
      expect(describeImport(r)).toMatch(/^Nothing was imported: /);
    });
  }

  it("an unreadable stored file is never written", async () => {
    localStorage.setItem(PRESETS_KEY, "{not json");
    const r = await imp(file([entry("resample", "A", RESAMPLE)]));
    expect(r).toMatchObject({ ok: false });
    expect(localStorage.getItem(PRESETS_KEY)).toBe("{not json");
  });

  it("a refused storage write imports nothing", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      const r = await imp(file([entry("resample", "A", RESAMPLE)]));
      expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("refused the write") });
    } finally {
      spy.mockRestore();
    }
    expect(stored()).toEqual([]);
  });
});

describe("per-preset validation", () => {
  it("a newer schema is kept locked, byte-identical, and never applied", async () => {
    const r = await imp(file([entry("resample", "Future", { nPoints: "5", wibble: true }, 2)]));
    expect(r).toMatchObject({ ok: true, imported: 0, locked: 1, skipped: [] });
    expect(stored()).toMatchObject([{ name: "Future", schema: 2, settings: { nPoints: "5", wibble: true } }]);
    expect(listPresets(resample).entries).toMatchObject([{ state: "locked", reason: expect.stringContaining("newer version") }]);
    expect(describeImport(r)).toContain("1 locked");
  });

  it("an unknown field is rejected with the field named; nothing is stored for it", async () => {
    const r = await imp(file([entry("resample", "Hand edited", { ...RESAMPLE, datasetId: "d1" }), entry("resample", "Fine", RESAMPLE)]));
    expect(r).toMatchObject({ ok: true, imported: 1, skipped: [{ name: "Hand edited", workshop: "resample", reason: "setting 'datasetId' is not known to this version" }] });
    expect(names("resample")).toEqual(["Fine"]);
    expect(describeImport(r)).toContain("'Hand edited' (resample): setting 'datasetId' is not known to this version");
  });

  it("a wrong type or out-of-range value is rejected with the field named", async () => {
    const r = await imp(file([entry("resample", "T", { ...RESAMPLE, sortUnsorted: "yes" }), entry("outlier-screening", "R", { ...OUTLIER, method: "grubbs", alpha: 7 })]));
    expect(r).toMatchObject({ ok: true, imported: 0 });
    if (!r.ok) return;
    expect(r.skipped.map((s) => s.reason)).toEqual([expect.stringContaining("'sortUnsorted'"), expect.stringContaining("'alpha'")]);
  });

  it("an unknown tool is skipped and named, and the rest still imports", async () => {
    const r = await imp(file([entry("warp-drive", "Engage", { speed: 9 }), entry("resample", "Fine", RESAMPLE)]));
    expect(r).toMatchObject({ ok: true, imported: 1, skipped: [{ workshop: "warp-drive", name: "Engage", reason: "unknown tool 'warp-drive'" }] });
  });

  it("an empty or over-long name is skipped with the reason", async () => {
    const r = await imp(file([entry("resample", "   ", RESAMPLE), entry("resample", "y".repeat(65), RESAMPLE)]));
    expect(r).toMatchObject({ ok: true, imported: 0 });
    if (r.ok) expect(r.skipped.map((s) => s.reason)).toEqual(["the name is empty", expect.stringContaining("longer than 64")]);
  });

  it("a newer-schema preset for a legacy-store tool is skipped (it cannot be kept locked there), with the reason", async () => {
    const r = await imp(file([entry("curvefit", "Future fit", FIT, 9)]));
    expect(r).toMatchObject({ ok: true, imported: 0, locked: 0, skipped: [{ name: "Future fit", reason: expect.stringContaining("cannot be kept locked") }] });
    expect(curvefit.backend!.list().entries).toEqual([]);
  });

  it("other stored records (another tool, a newer build, malformed) pass through an import untouched", async () => {
    const foreign = { id: "p1:other", workshop: "warp-drive", name: "Theirs", schema: 5, settings: { a: 1 }, createdAt: "t", updatedAt: "t" };
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [foreign, "junk"] }));
    await imp(file([entry("resample", "New", RESAMPLE)]));
    const raw = (JSON.parse(localStorage.getItem(PRESETS_KEY)!) as { presets: unknown[] }).presets;
    expect(raw.slice(0, 2)).toEqual([foreign, "junk"]);
    expect(raw).toHaveLength(3);
  });

  it("imported presets are listed as ready through the bar's own backend", async () => {
    await imp(file([entry("resample", "Dense", RESAMPLE)]));
    const [e] = genericBackend(resample).list().entries;
    expect(e).toMatchObject({ state: "ok", settings: RESAMPLE });
  });
});

describe("parsePresetFile", () => {
  it("fills missing timestamps and refuses a huge file", () => {
    const p = parsePresetFile(file([{ workshop: "resample", name: "A", schema: 1, settings: RESAMPLE }]));
    expect(p.ok && Number.isFinite(Date.parse(p.presets[0].createdAt))).toBe(true);
    expect(parsePresetFile("x".repeat(9 * 1024 * 1024))).toMatchObject({ ok: false, reason: expect.stringContaining("too large") });
  });
});
