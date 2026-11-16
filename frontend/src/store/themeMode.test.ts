// "Follow system" theme (UX audit 7, lane G1): the first-run default follows the
// OS colour scheme (`prefers-color-scheme`), a user's explicit pick is kept, and
// a live OS change re-themes only while the choice is still "system".
//
// `themeMode` is the user's CHOICE ("system" | "dark" | "light"); `theme` stays
// the EFFECTIVE dark/light every renderer reads. Each test gets a fresh store
// module (vi.resetModules) so the load-time resolution is the thing under test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREFS_KEY } from "./prefs";

type Listener = () => void;
let osLight = false;
let listeners: Listener[] = [];

beforeEach(() => {
  osLight = false;
  listeners = [];
  localStorage.removeItem(PREFS_KEY);
  window.matchMedia = ((q: string) => ({
    get matches() {
      return q.includes("prefers-color-scheme: light") ? osLight : false;
    },
    media: q,
    addEventListener: (_: string, cb: Listener) => listeners.push(cb),
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  vi.resetModules();
});

afterEach(() => {
  localStorage.removeItem(PREFS_KEY);
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.resetModules();
});

const fresh = async () => (await import("./useApp")).useApp;
const flipOs = (light: boolean) => {
  osLight = light;
  listeners.forEach((cb) => cb());
};

describe("first run (no stored prefs)", () => {
  it("defaults to the system choice and renders the OS theme: light OS -> light", async () => {
    osLight = true;
    const s = (await fresh()).getState();
    expect([s.themeMode, s.theme]).toEqual(["system", "light"]);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("dark OS -> dark", async () => {
    const s = (await fresh()).getState();
    expect([s.themeMode, s.theme]).toEqual(["system", "dark"]);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("an environment without matchMedia falls back to the historical dark theme", async () => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    const s = (await fresh()).getState();
    expect([s.themeMode, s.theme]).toEqual(["system", "dark"]);
  });
});

describe("an explicit choice is kept", () => {
  it("a persisted themeMode wins over the OS", async () => {
    osLight = true;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ themeMode: "dark", theme: "dark" }));
    const s = (await fresh()).getState();
    expect([s.themeMode, s.theme]).toEqual(["dark", "dark"]);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("a LEGACY blob (theme only, written before this option) loads as that explicit pick", async () => {
    osLight = true;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "dark" }));
    const s = (await fresh()).getState();
    expect([s.themeMode, s.theme]).toEqual(["dark", "dark"]);
  });

  it("setTheme (the title-bar toggle) pins the choice and persists it", async () => {
    const app = await fresh();
    app.getState().setTheme("light");
    expect([app.getState().themeMode, app.getState().theme]).toEqual(["light", "light"]);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({ themeMode: "light", theme: "light" });
  });

  it("the explicit choice survives a reload while the OS disagrees", async () => {
    const app = await fresh();
    app.getState().setTheme("dark");
    vi.resetModules();
    osLight = true;
    const s = (await fresh()).getState();
    expect([s.themeMode, s.theme]).toEqual(["dark", "dark"]);
  });
});

describe("following the OS live", () => {
  it("re-themes on an OS change while the choice is system", async () => {
    const app = await fresh();
    expect(app.getState().theme).toBe("dark");
    flipOs(true);
    expect(app.getState().theme).toBe("light");
    expect(app.getState().themeMode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ignores an OS change once the user pinned a theme", async () => {
    const app = await fresh();
    app.getState().setTheme("dark");
    flipOs(true);
    expect(app.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("setThemeMode('system') hands control back to the OS immediately", async () => {
    const app = await fresh();
    app.getState().setTheme("dark");
    osLight = true;
    app.getState().setThemeMode("system");
    expect([app.getState().themeMode, app.getState().theme]).toEqual(["system", "light"]);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("setPref('themeMode', ...) (the Preferences dialog) resolves the effective theme too", async () => {
    const app = await fresh();
    osLight = true;
    app.getState().setPref("themeMode", "system");
    expect(app.getState().theme).toBe("light");
    app.getState().setPref("themeMode", "dark");
    expect([app.getState().themeMode, app.getState().theme]).toEqual(["dark", "dark"]);
  });
});
