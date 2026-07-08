import { describe, expect, it } from "vitest";

import {
  CHANNEL_DND,
  decodeChannelDrag,
  encodeChannelDrag,
  resolveAxisDrop,
  resolveAxisZone,
  type AxisAssignment,
} from "./dragaxis";
import type { Dataset } from "./types";

// 4 dense, equal-length channels: A/B continuous, C nominal-looking (3
// distinct values repeated 5x — clears modeling.ts's MIN_SAMPLES=12 /
// NOMINAL_MAX_LEVELS=8 thresholds), D plain continuous (used as a "labeled"
// role channel in some cases). defaultDenseChannels(ds, null) == [0,1,2,3]
// (all channels equally dense — nothing gets excluded).
function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  const n = 15;
  const time = Array.from({ length: n }, (_, i) => i);
  const values = Array.from({ length: n }, (_, i) => [i * 2, 100 - i, (i % 3) + 1, i]);
  return {
    id: "ds1",
    name: "test",
    data: {
      time,
      values,
      labels: ["A", "B", "C", "D"],
      units: ["emu", "Oe", "", "K"],
      metadata: {},
    },
    ...overrides,
  };
}

const NO_AXIS: AxisAssignment = { xKey: null, yKeys: null, y2Keys: null };

describe("encodeChannelDrag / decodeChannelDrag", () => {
  it("round-trips a payload", () => {
    const raw = encodeChannelDrag({ datasetId: "ds1", channel: 2 });
    expect(decodeChannelDrag(raw)).toEqual({ datasetId: "ds1", channel: 2 });
  });

  it("uses a distinct MIME so drop targets can tell it apart from other drags", () => {
    expect(CHANNEL_DND).not.toBe("application/x-qz-dataset");
  });

  it("rejects malformed JSON", () => {
    expect(decodeChannelDrag("not json")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(decodeChannelDrag("")).toBeNull();
  });

  it("rejects JSON missing required fields", () => {
    expect(decodeChannelDrag(JSON.stringify({ datasetId: "ds1" }))).toBeNull();
    expect(decodeChannelDrag(JSON.stringify({ channel: 1 }))).toBeNull();
  });

  it("rejects a non-integer channel", () => {
    expect(decodeChannelDrag(JSON.stringify({ datasetId: "ds1", channel: 1.5 }))).toBeNull();
  });

  it("rejects a foreign payload shape (e.g. an OS file-drop or the Library's DATASET_DND)", () => {
    expect(decodeChannelDrag(JSON.stringify("ds1"))).toBeNull();
    expect(decodeChannelDrag(JSON.stringify(42))).toBeNull();
  });
});

describe("resolveAxisZone", () => {
  const rect = { width: 600, height: 400 };
  // bandH = clamp(400*0.22, 32, 88) = 88; bandW = clamp(600*0.16, 32, 88) = 88.

  it("resolves the dead interior to null (drop-in-the-middle cancels)", () => {
    expect(resolveAxisZone(rect, { x: 300, y: 200 })).toBeNull();
  });

  it("resolves the bottom strip to X", () => {
    expect(resolveAxisZone(rect, { x: 300, y: 350 })).toBe("x");
  });

  it("resolves the left strip to Y", () => {
    expect(resolveAxisZone(rect, { x: 40, y: 150 })).toBe("y");
  });

  it("resolves the right strip to Y2", () => {
    expect(resolveAxisZone(rect, { x: 560, y: 150 })).toBe("y2");
  });

  it("gives the bottom (X) band priority in a corner overlap", () => {
    expect(resolveAxisZone(rect, { x: 10, y: 390 })).toBe("x");
    expect(resolveAxisZone(rect, { x: 590, y: 390 })).toBe("x");
  });

  it("still resolves a non-bottom corner to its band", () => {
    expect(resolveAxisZone(rect, { x: 5, y: 5 })).toBe("y");
    expect(resolveAxisZone(rect, { x: 595, y: 5 })).toBe("y2");
  });

  it("is inclusive at the band boundary", () => {
    expect(resolveAxisZone(rect, { x: 300, y: 312 })).toBe("x"); // height - bandH
    expect(resolveAxisZone(rect, { x: 88, y: 100 })).toBe("y");
    expect(resolveAxisZone(rect, { x: 512, y: 100 })).toBe("y2");
  });

  it("resolves a point outside the rect to null", () => {
    expect(resolveAxisZone(rect, { x: -5, y: 100 })).toBeNull();
    expect(resolveAxisZone(rect, { x: 650, y: 100 })).toBeNull();
    expect(resolveAxisZone(rect, { x: 100, y: -1 })).toBeNull();
    expect(resolveAxisZone(rect, { x: 100, y: 401 })).toBeNull();
  });

  it("resolves a zero-size rect to null (never divides by zero / hangs)", () => {
    expect(resolveAxisZone({ width: 0, height: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it("floors band size on a tiny stage (BAND_MIN_PX) rather than shrinking to nothing", () => {
    // 50x50: bandH = bandW = 32 (the min floor dominates the fraction here).
    // The center point falls inside the oversized bottom band as a result —
    // documenting the consequence of the floor, not asserting it's ideal.
    expect(resolveAxisZone({ width: 50, height: 50 }, { x: 25, y: 25 })).toBe("x");
  });
});

describe("resolveAxisDrop — X zone", () => {
  it("sets a continuous channel as X with no categorical note", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, NO_AXIS, "x", { datasetId: "ds1", channel: 1 });
    expect(result.actions).toEqual([{ kind: "setXKey", xKey: 1 }]);
    expect(result.categoricalXNote).toBeUndefined();
    expect(result.noop).toBeUndefined();
  });

  it("sets a nominal channel as X but flags the categorical-X note (GAP_PLOTTYPES #4 cross-reference)", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, NO_AXIS, "x", { datasetId: "ds1", channel: 2 });
    expect(result.actions).toEqual([{ kind: "setXKey", xKey: 2 }]);
    expect(result.categoricalXNote).toMatch(/categorical axes land with plot-types item 4/);
    expect(result.categoricalXNote).toMatch(/"C"/);
  });

  it("honors a channelTypes override even when the raw values look continuous", () => {
    const ds = makeDataset({ channelTypes: { 0: "nominal" } });
    const result = resolveAxisDrop(ds, NO_AXIS, "x", { datasetId: "ds1", channel: 0 });
    expect(result.categoricalXNote).toBeDefined();
  });

  it("is a no-op when the channel is already X", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, { ...NO_AXIS, xKey: 1 }, "x", { datasetId: "ds1", channel: 1 });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/already the X axis/);
  });

  it("allows a Label/Ignore-role channel onto X (matches the Channels card's X select, which lists every channel)", () => {
    const ds = makeDataset({ channelRoles: { 3: "label" } });
    const result = resolveAxisDrop(ds, NO_AXIS, "x", { datasetId: "ds1", channel: 3 });
    expect(result.actions).toEqual([{ kind: "setXKey", xKey: 3 }]);
    expect(result.noop).toBeUndefined();
  });
});

describe("resolveAxisDrop — Y zone", () => {
  it("adds a not-yet-visible channel to an explicit yKeys list", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, { ...NO_AXIS, yKeys: [0] }, "y", { datasetId: "ds1", channel: 1 });
    expect(result.actions).toEqual([{ kind: "setYKeys", yKeys: [0, 1] }]);
  });

  it("collapses back to the auto sentinel (null) when the addition matches the dense default", () => {
    const ds = makeDataset(); // dense default = [0,1,2,3]
    const result = resolveAxisDrop(ds, { ...NO_AXIS, yKeys: [0, 1, 2] }, "y", {
      datasetId: "ds1",
      channel: 3,
    });
    expect(result.actions).toEqual([{ kind: "setYKeys", yKeys: null }]);
  });

  it("is a no-op when the channel is already plotted on Y", () => {
    const ds = makeDataset();
    // yKeys=null → the dense default already includes every channel.
    const result = resolveAxisDrop(ds, NO_AXIS, "y", { datasetId: "ds1", channel: 1 });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/already plotted on Y/);
  });

  it("is a no-op for a Label/Ignore-role channel (matches the disabled checkbox in ChannelsCard)", () => {
    const ds = makeDataset({ channelRoles: { 3: "label" } });
    const result = resolveAxisDrop(ds, { ...NO_AXIS, yKeys: [0] }, "y", { datasetId: "ds1", channel: 3 });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/Label\/Ignore/);
  });

  it("is a no-op for the current X channel", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, { ...NO_AXIS, xKey: 0 }, "y", { datasetId: "ds1", channel: 0 });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/X channel/);
  });
});

describe("resolveAxisDrop — Y2 zone", () => {
  it("adds a not-yet-visible channel to both Y (implicit) and Y2 — two ordered actions", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, { ...NO_AXIS, yKeys: [0, 1] }, "y2", {
      datasetId: "ds1",
      channel: 2,
    });
    expect(result.actions).toEqual([
      { kind: "setYKeys", yKeys: [0, 1, 2] },
      { kind: "setY2Keys", y2Keys: [2] },
    ]);
  });

  it("adds an already-visible primary channel to Y2 with just one action", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, { ...NO_AXIS, yKeys: [0, 1] }, "y2", {
      datasetId: "ds1",
      channel: 1,
    });
    expect(result.actions).toEqual([{ kind: "setY2Keys", y2Keys: [1] }]);
  });

  it("refuses to move the last remaining primary Y series to Y2", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, { ...NO_AXIS, yKeys: [2] }, "y2", {
      datasetId: "ds1",
      channel: 2,
    });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/no primary Y series/);
  });

  it("is a no-op when the channel is already on Y2", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, { ...NO_AXIS, yKeys: [0, 1], y2Keys: [1] }, "y2", {
      datasetId: "ds1",
      channel: 1,
    });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/already on the Y2 axis/);
  });

  it("is a no-op for a Label/Ignore-role channel", () => {
    const ds = makeDataset({ channelRoles: { 3: "ignore" } });
    const result = resolveAxisDrop(ds, NO_AXIS, "y2", { datasetId: "ds1", channel: 3 });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/Label\/Ignore/);
  });
});

describe("resolveAxisDrop — cross-cutting validation", () => {
  it("is a no-op for a chip dragged from a different (non-active) dataset", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, NO_AXIS, "y", { datasetId: "other-ds", channel: 0 });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/different dataset/);
  });

  it("is a no-op for an out-of-range channel index", () => {
    const ds = makeDataset();
    const result = resolveAxisDrop(ds, NO_AXIS, "x", { datasetId: "ds1", channel: 99 });
    expect(result.actions).toEqual([]);
    expect(result.noop).toMatch(/invalid channel/);
    const negative = resolveAxisDrop(ds, NO_AXIS, "x", { datasetId: "ds1", channel: -1 });
    expect(negative.noop).toMatch(/invalid channel/);
  });
});
