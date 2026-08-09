import { describe, expect, it } from "vitest";

import { fitAspectRect, shouldLockAspect } from "./mapAspect";

describe("shouldLockAspect", () => {
  it("locks when both axes share a non-angular unit (Qx/Qz)", () => {
    expect(shouldLockAspect("Ang^-1", "Ang^-1")).toBe(true);
  });

  it("does not lock angular axes, even though 2Theta/Omega both carry 'deg' (regression guard)", () => {
    expect(shouldLockAspect("deg", "deg")).toBe(false);
  });

  it("does not lock on other angular unit spellings", () => {
    expect(shouldLockAspect("rad", "rad")).toBe(false);
    expect(shouldLockAspect("degrees", "degrees")).toBe(false);
    expect(shouldLockAspect("°", "°")).toBe(false);
  });

  it("does not lock different units", () => {
    expect(shouldLockAspect("Ang^-1", "deg")).toBe(false);
    expect(shouldLockAspect("nm", "eV")).toBe(false);
  });

  it("does not lock when either unit is empty (no known unit)", () => {
    expect(shouldLockAspect("", "")).toBe(false);
    expect(shouldLockAspect("Ang^-1", "")).toBe(false);
  });

  it("locks a future same-unit, non-angular pair (future-proofing check)", () => {
    expect(shouldLockAspect("nm", "nm")).toBe(true);
  });
});

describe("fitAspectRect", () => {
  const avail = { x: 58, y: 14, w: 464, h: 344 }; // 600x400 pane, MARGIN-trimmed

  it("fills the pane exactly when the data aspect matches the pane aspect", () => {
    // avail aspect = 464/344; pick spans in that exact ratio.
    const rect = fitAspectRect(avail, 464, 344);
    expect(rect).toEqual(avail);
  });

  it("letterboxes top/bottom when the data is relatively WIDER than the pane", () => {
    // dataAspect = 10 (very wide) > availAspect (~1.35) -> width-limited.
    const rect = fitAspectRect(avail, 10, 1);
    expect(rect.w).toBe(avail.w);
    expect(rect.h).toBeCloseTo(avail.w / 10, 9);
    // centred vertically, unmoved horizontally
    expect(rect.x).toBe(avail.x);
    expect(rect.y).toBeCloseTo(avail.y + (avail.h - rect.h) / 2, 9);
  });

  it("letterboxes left/right when the data is relatively TALLER than the pane", () => {
    // dataAspect = 0.25 (tall) < availAspect (~1.35) -> height-limited.
    const rect = fitAspectRect(avail, 1, 4);
    expect(rect.h).toBe(avail.h);
    expect(rect.w).toBeCloseTo(avail.h * 0.25, 9);
    // centred horizontally, unmoved vertically
    expect(rect.y).toBe(avail.y);
    expect(rect.x).toBeCloseTo(avail.x + (avail.w - rect.w) / 2, 9);
  });

  it("stays centred within avail (slack is split evenly, not pinned to a corner)", () => {
    const rect = fitAspectRect(avail, 1, 4);
    const leftSlack = rect.x - avail.x;
    const rightSlack = avail.x + avail.w - (rect.x + rect.w);
    expect(leftSlack).toBeCloseTo(rightSlack, 9);
  });

  it("falls back to filling avail on a degenerate (zero) span — nothing to preserve", () => {
    expect(fitAspectRect(avail, 0, 5)).toEqual(avail);
    expect(fitAspectRect(avail, 5, 0)).toEqual(avail);
    expect(fitAspectRect(avail, 0, 0)).toEqual(avail);
  });

  it("falls back to filling avail on a non-finite span", () => {
    expect(fitAspectRect(avail, NaN, 5)).toEqual(avail);
    expect(fitAspectRect(avail, 5, -3)).toEqual(avail);
  });
});
