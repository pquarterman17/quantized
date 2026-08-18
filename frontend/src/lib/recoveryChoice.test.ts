import { describe, expect, it } from "vitest";

import { shouldOfferRecoveryChoice } from "./recoveryChoice";

describe("shouldOfferRecoveryChoice (P1.2 box 5)", () => {
  it("offers a choice when the autosave is newer than the last-known project", () => {
    expect(shouldOfferRecoveryChoice(200, { name: "a.dwk", path: "/a.dwk", at: 100 })).toBe(true);
  });

  it("does not offer a choice when the autosave is older than the last project", () => {
    expect(shouldOfferRecoveryChoice(50, { name: "a.dwk", path: "/a.dwk", at: 100 })).toBe(false);
  });

  it("does not offer a choice when the autosave exactly matches the last project's time", () => {
    // Nothing newer to recover — the named project already reflects it.
    expect(shouldOfferRecoveryChoice(100, { name: "a.dwk", path: "/a.dwk", at: 100 })).toBe(false);
  });

  it("never offers a choice when there is no last-known project — nothing named to protect", () => {
    expect(shouldOfferRecoveryChoice(200, null)).toBe(false);
  });
});
