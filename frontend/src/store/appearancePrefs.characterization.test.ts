// Characterization tests for the APPEARANCE + PREFERENCE domain (audit P4.1,
// the TWELFTH store/useApp.ts domain): every `Prefs` key as a store field
// (theme, accent, density, palette and the Preferences-dialog behaviour
// prefs), seeded from the persisted `qz.prefs` blob at store creation, and
// the five writers — setTheme, setAccent, setDensity, setPalette, setPref.
//
// What each spec pins: the initial value of every pref field (defaults on an
// empty storage, the persisted value otherwise), and for every writer the
// EXACT set of top-level store keys a call changes — diffing the WHOLE
// `getState()` snapshot by identity against a POISONED baseline, so a call
// that records an undo step or touches another field shows up — plus the
// persist (`qz.prefs`) and live-apply (`<html>` data-*) side effects.
//
// Written and run GREEN against the pre-extraction useApp.ts; it imports the
// store only through `./useApp` (plus ./prefs, which does not move), so
// nothing here may change when the domain moves out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREF_DEFAULTS, PREFS_KEY, type Prefs } from "./prefs";
import type { AppState, PrefKey } from "./useApp";
import { useApp } from "./useApp";

type Snap = Record<string, unknown>;
const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}
const act = (): AppState => useApp.getState();
const stored = (): Record<string, unknown> => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");

// A non-default value for every Prefs key (the POISON), and a second,
// different one each writer spec sets — so neither can be a no-op write.
const POISON: Prefs = {
  theme: "light",
  accent: "teal",
  density: "compact",
  palette: "viridis",
  autoSeriesStyles: true,
  reduceMotion: true,
  wheelZoom: false,
  defaultTrace: "Scatter",
  defaultLineWidth: 3,
  defaultGrid: false,
  antialias: false,
  sigFigs: 3,
  notation: "scientific",
  confirmRemove: true,
  excludedDisplay: "hide",
  originBookClickOpens: "plot",
  defaultPanelFit: "window",
  libraryPanelWidth: 300,
  copyFigureTransparent: true,
};
const NEXT: Prefs = {
  theme: "dark",
  accent: "rose",
  density: "comfy",
  palette: "default",
  autoSeriesStyles: false,
  reduceMotion: false,
  wheelZoom: true,
  defaultTrace: "Step",
  defaultLineWidth: 2,
  defaultGrid: true,
  antialias: true,
  sigFigs: 8,
  notation: "fixed",
  confirmRemove: false,
  excludedDisplay: "grey",
  originBookClickOpens: "worksheet",
  defaultPanelFit: "frames",
  libraryPanelWidth: 250,
  copyFigureTransparent: false,
};
const KEYS = Object.keys(PREF_DEFAULTS) as PrefKey[];

beforeEach(() => {
  useApp.setState({ ...POISON });
});

afterEach(() => {
  localStorage.removeItem(PREFS_KEY);
  vi.resetModules();
});

describe("pref fields: initial state", () => {
  it("POISON/NEXT cover every Prefs key (the table cannot go stale)", () => {
    expect(Object.keys(POISON).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(NEXT).sort()).toEqual([...KEYS].sort());
  });

  it("an empty storage starts every pref field at PREF_DEFAULTS", () => {
    const init = useApp.getInitialState() as unknown as Snap;
    expect(Object.fromEntries(KEYS.map((k) => [k, init[k]]))).toEqual(PREF_DEFAULTS);
  });

  it("a persisted blob seeds every pref field (libraryPanelWidth included)", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...POISON, excludedDisplayV2: "hide" }));
    vi.resetModules();
    const fresh = (await import("./useApp")).useApp.getInitialState() as unknown as Snap;
    expect(Object.fromEntries(KEYS.map((k) => [k, fresh[k]]))).toEqual(POISON);
  });

  it("module load applies the persisted appearance to <html>", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "light", accent: "amber", density: "comfy", reduceMotion: true }));
    vi.resetModules();
    await import("./useApp");
    const el = document.documentElement;
    expect([el.dataset.theme, el.dataset.accent, el.dataset.density, el.dataset.reduceMotion]).toEqual([
      "light",
      "amber",
      "comfy",
      "",
    ]);
  });
});

const NAMED: [keyof AppState, "theme" | "accent" | "density" | "palette"][] = [
  ["setTheme", "theme"],
  ["setAccent", "accent"],
  ["setDensity", "density"],
  ["setPalette", "palette"],
];

describe("named appearance setters", () => {
  it.each(NAMED)("%s writes ONLY %s, and persists the whole prefs blob", (action, field) => {
    const before = snapshot();
    (act()[action] as (v: string) => void)(NEXT[field]);
    expect(changedSince(before)).toEqual([field]);
    expect(act()[field]).toBe(NEXT[field]);
    expect(stored()).toMatchObject({ ...POISON, [field]: NEXT[field] });
  });

  it.each(NAMED)("%s with the current value: no observable diff", (action, field) => {
    const before = snapshot();
    (act()[action] as (v: string) => void)(POISON[field]);
    expect(changedSince(before)).toEqual([]);
  });

  it("theme/accent/density apply live to <html>", () => {
    act().setTheme("dark");
    act().setAccent("ocean");
    act().setDensity("regular");
    const el = document.documentElement;
    expect([el.dataset.theme, el.dataset.accent, el.dataset.density]).toEqual(["dark", "ocean", "regular"]);
  });
});

describe("setPref (the Preferences dialog's generic writer)", () => {
  it.each(KEYS)("setPref(%s) writes ONLY that key and persists it", (key) => {
    const before = snapshot();
    act().setPref(key, NEXT[key]);
    expect(changedSince(before)).toEqual([key]);
    expect((act() as unknown as Snap)[key]).toEqual(NEXT[key]);
    expect(stored()[key]).toEqual(NEXT[key]);
  });

  it("persists excludedDisplay under the V2 key as well", () => {
    act().setPref("excludedDisplay", "grey");
    expect(stored().excludedDisplayV2).toBe("grey");
  });

  it("reduceMotion applies live to <html>", () => {
    act().setPref("reduceMotion", false);
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();
    act().setPref("reduceMotion", true);
    expect(document.documentElement.dataset.reduceMotion).toBe("");
  });

  it("libraryPanelWidth applies live to the --lw custom property", () => {
    act().setPref("libraryPanelWidth", 333);
    expect(document.documentElement.style.getPropertyValue("--lw")).toBe("333px");
  });
});
