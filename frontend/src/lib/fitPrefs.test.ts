import { afterEach, describe, expect, it } from "vitest";

import { bootstrapCap, BOOTSTRAP_CAP_DEFAULT, FIT_PREFS_KEY, saveBootstrapCap, validBootstrapCap } from "./fitPrefs";

afterEach(() => localStorage.removeItem(FIT_PREFS_KEY));

describe("fit prefs", () => {
  it("defaults to 10,000", () => expect(bootstrapCap()).toBe(BOOTSTRAP_CAP_DEFAULT));
  it("persists a valid cap", () => {
    saveBootstrapCap(250_000);
    expect(bootstrapCap()).toBe(250_000);
  });
  it("refuses values outside 20..1,000,000 or non-integers, and ignores a corrupt slot", () => {
    for (const bad of [19, 1_000_001, 12.5, NaN]) expect(validBootstrapCap(bad)).toBeNull();
    saveBootstrapCap(5);
    expect(bootstrapCap()).toBe(BOOTSTRAP_CAP_DEFAULT);
    localStorage.setItem(FIT_PREFS_KEY, JSON.stringify({ bootstrapCap: 3 }));
    expect(bootstrapCap()).toBe(BOOTSTRAP_CAP_DEFAULT);
    localStorage.setItem(FIT_PREFS_KEY, "{not json");
    expect(bootstrapCap()).toBe(BOOTSTRAP_CAP_DEFAULT);
  });
});
