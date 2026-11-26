// Plan item 18: the overlap-avoiding label placement rule, asserted against the
// fixture it shares with `calc/label_placement.py` (tests/test_calc_label_placement.py).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { placeLabels, type PlaceItem, type PlaceOpts, type PlaceRect } from "./labelPlacement";

interface Case {
  name: string; rect: PlaceRect; opts: { gap: number; marker_r: number; step: number; rings: number; pad: number; leader_min: number };
  items: PlaceItem[]; metric_robust?: boolean;
  placed: { left: number; top: number; overlap: boolean; leader: number[] | null }[];
}
const WIRE = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/wire");
const FIX = JSON.parse(readFileSync(join(WIRE, "point_label_placement.json"), "utf-8")) as { tolerance: number; cases: Case[] };
const optsOf = (o: Case["opts"]): PlaceOpts => ({ gap: o.gap, markerR: o.marker_r, step: o.step, rings: o.rings, pad: o.pad, leaderMin: o.leader_min });
const run = (c: Case, scale = 1) => placeLabels(c.items.map((i) => ({ ...i, w: i.w * scale })), c.rect, optsOf(c.opts));
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(FIX.tolerance);

describe("placeLabels, the shared rule", () => {
  it.each(FIX.cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const got = run(c);
    expect(got).toHaveLength(c.placed.length);
    got.forEach((g, i) => {
      const want = c.placed[i];
      near(g.left, want.left);
      near(g.top, want.top);
      expect(g.overlap).toBe(want.overlap);
      if (want.leader === null) expect(g.leader).toBeNull();
      else want.leader.forEach((v, k) => near(g.leader?.[k] ?? NaN, v));
    });
  });

  it.each(FIX.cases.filter((c) => c.metric_robust).flatMap((c) => [[c.name, c, 0.95], [c.name, c, 1.05]] as const))(
    "a text-width spread keeps flags and leaders: %s (x%s)", (_n, c, scale) => {
      run(c, scale).forEach((g, i) => {
        expect(g.overlap).toBe(c.placed[i].overlap);
        expect(g.leader === null).toBe(c.placed[i].leader === null);
      });
    });

  it("a dense cluster has no overlapping boxes and is deterministic", () => {
    const c = FIX.cases.find((k) => k.name.startsWith("a dense cluster"))!;
    const got = run(c);
    expect(run(c)).toEqual(got);
    const b = got.map((g, i) => ({ l: g.left, t: g.top, r: g.left + c.items[i].w, b: g.top + c.items[i].h }));
    expect(got.some((g) => g.overlap)).toBe(false);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      expect(b[i].r <= b[j].l || b[j].r <= b[i].l || b[i].b <= b[j].t || b[j].b <= b[i].t).toBe(true);
    }
  });

  it("a label with no room stays at the default slot, flagged", () => {
    const c = FIX.cases.find((k) => k.name.includes("no free slot"))!;
    const [g] = run(c);
    expect(g.overlap).toBe(true);
    expect([g.left, g.top]).toEqual([c.items[0].ax + 4, c.items[0].ay - 4 - c.items[0].h]);
  });

  it("leader lines only past the threshold", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ ax: 100 + i * 3, ay: 50, w: 30, h: 10, importance: 20 - i }));
    const rect = { left: 0, top: 0, right: 200, bottom: 100 };
    const o = { gap: 4, markerR: 3, step: 12, rings: 6, pad: 1, leaderMin: 1.5 };
    expect(placeLabels(items, rect, o).some((p) => p.leader)).toBe(true);
    expect(placeLabels(items, rect, { ...o, leaderMin: 50 }).some((p) => p.leader)).toBe(false);
    expect(placeLabels([{ ax: 50, ay: 50, w: 24, h: 10, importance: 1 }], rect, o)[0].leader).toBeNull();
  });
});
