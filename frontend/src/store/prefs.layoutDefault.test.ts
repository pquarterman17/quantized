// Owner decision 2026-11-26: the window layout is the default; an explicit choice (classic included) is kept.
// test/setup.ts seeds an explicit classic choice for the rest of the suite, so every case here sets its own
// storage and reads it back through loadPrefs().
import { beforeEach, describe, expect, it } from "vitest";

import { resetPrefFields } from "../lib/prefsReset";
import { LAYOUT_MODE_KEY, loadPrefs, markLayoutModeExplicit, PREF_DEFAULTS, PREFS_KEY, syncPrefs } from "./prefs";
import { useApp } from "./useApp";

const store = (v: unknown) => localStorage.setItem(PREFS_KEY, typeof v === "string" ? v : JSON.stringify(v));
const stored = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  markLayoutModeExplicit(null);
  useApp.setState({ layoutMode: "windows", windowLayout: null });
});

describe("layoutMode default and explicit choice", () => {
  it("defaults to windows for a fresh profile", () => {
    expect(PREF_DEFAULTS.layoutMode).toBe("windows");
    expect(loadPrefs().layoutMode).toBe("windows");
  });

  it("treats junk and an unreadable blob as unset (the default)", () => {
    store({ layoutMode: "sideways", [LAYOUT_MODE_KEY]: 7 });
    expect(loadPrefs().layoutMode).toBe("windows");
    store("{not json");
    expect(loadPrefs().layoutMode).toBe("windows");
  });

  it("keeps a legacy stored windows (it was an explicit opt-in)", () => {
    store({ layoutMode: "windows" });
    expect(loadPrefs().layoutMode).toBe("windows");
  });

  it("moves a legacy stored classic to the default: it was written on any pref change, so it is not a choice", () => {
    store({ layoutMode: "classic", sigFigs: 4 });
    expect(loadPrefs().layoutMode).toBe("windows");
  });

  it("keeps an explicit classic and an explicit windows under the V2 key, whatever the legacy key says", () => {
    store({ layoutMode: "windows", [LAYOUT_MODE_KEY]: "classic" });
    expect(loadPrefs().layoutMode).toBe("classic");
    store({ layoutMode: "classic", [LAYOUT_MODE_KEY]: "windows" });
    expect(loadPrefs().layoutMode).toBe("windows");
  });

  it("writes the V2 key only after an explicit switch, so an unrelated pref change never fixes the default as a choice", () => {
    loadPrefs();
    useApp.getState().setPref("sigFigs", 4);
    expect(stored().sigFigs).toBe(4);
    expect(LAYOUT_MODE_KEY in stored()).toBe(false);
  });

  it("persists a switch to classic as an explicit choice that survives a reload", async () => {
    loadPrefs();
    await useApp.getState().setLayoutMode("classic");
    expect(stored()[LAYOUT_MODE_KEY]).toBe("classic");
    useApp.getState().setPref("sigFigs", 5); // later unrelated writes keep it
    expect(stored()[LAYOUT_MODE_KEY]).toBe("classic");
    expect(loadPrefs().layoutMode).toBe("classic");
  });

  it("does not record the fail-closed fallback after a layout that cannot load as a choice", () => {
    loadPrefs();
    useApp.setState({ layoutMode: "classic" }); // what the failure path leaves behind (it goes through setPref)
    syncPrefs(useApp.getState());
    expect(LAYOUT_MODE_KEY in stored()).toBe(false);
    expect(loadPrefs().layoutMode).toBe("windows");
  });

  it("Reset forgets the explicit choice and returns to the default", async () => {
    loadPrefs();
    await useApp.getState().setLayoutMode("classic");
    resetPrefFields(["layoutMode"]);
    await expect.poll(() => useApp.getState().layoutMode).toBe("windows");
    await expect.poll(() => LAYOUT_MODE_KEY in stored()).toBe(false);
    expect(loadPrefs().layoutMode).toBe("windows");
  });
});
