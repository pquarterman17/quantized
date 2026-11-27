import { describe, expect, it } from "vitest";

import { looksLikeHysteresisLoop } from "./hysteresisLoopLook";

/** A tanh loop: Ms tanh((H -/+ Hc) / w) on the up / down branch, plus a slope, swept 0 -> +Hmax -> -Hmax -> +Hmax. */
function loop(n: number, hc: number, noise = 0, slope = 0): { h: number[]; m: number[] } {
  const hmax = 5000;
  const h: number[] = [];
  const m: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
  const sweep = (a: number, b: number, up: boolean) => {
    for (let i = 0; i < n; i++) {
      const v = a + ((b - a) * i) / (n - 1);
      h.push(v);
      m.push(Math.tanh((v + (up ? -hc : hc)) / 400) + slope * v + rnd());
    }
  };
  sweep(0, hmax, true);
  sweep(hmax, -hmax, false);
  sweep(-hmax, hmax, true);
  return { h, m };
}

describe("looksLikeHysteresisLoop", () => {
  it("recognises a two-branched loop, with a slope and with noise", () => {
    const a = loop(100, 150);
    expect(looksLikeHysteresisLoop(a.h, a.m)).toBe(true);
    const b = loop(100, 150, 0.05, 1e-5);
    expect(looksLikeHysteresisLoop(b.h, b.m)).toBe(true);
  });

  it("refuses a curve that retraces itself, one sweep, a one-sided X, and too few points", () => {
    const a = loop(100, 0); // zero coercivity: both branches coincide
    expect(looksLikeHysteresisLoop(a.h, a.m)).toBe(false);
    const x = Array.from({ length: 200 }, (_, i) => -5000 + 50 * i);
    expect(looksLikeHysteresisLoop(x, x.map((v) => Math.tanh((v - 150) / 400)))).toBe(false); // one sweep: no return branch
    const pos = loop(100, 150);
    expect(looksLikeHysteresisLoop(pos.h.map((v) => Math.abs(v) + 1), pos.m)).toBe(false); // X never negative
    expect(looksLikeHysteresisLoop([-1, 0, 1, 0, -1], [0, 1, 0, -1, 0])).toBe(false);
  });

  it("refuses pure noise swept out and back over a monotonic response", () => {
    const a = loop(200, 0, 0.1);
    expect(looksLikeHysteresisLoop(a.h, a.m)).toBe(false);
  });

  it("ignores non-finite samples", () => {
    const a = loop(100, 150);
    const m = a.m.slice();
    m[10] = NaN;
    expect(looksLikeHysteresisLoop(a.h, m)).toBe(true);
  });
});
