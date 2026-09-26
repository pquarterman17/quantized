// P2.6 interactive-vs-export STRUCTURAL parity, the A8 pattern
// (tests/test_export_vector_structure.py) applied to the level slots: ONE
// shared fixture, two suites.
//
//   * THIS file plots `tests/fixtures/wire/level_slots_statplot.json`'s
//     `dataset` through the real Stat Stage hook and asserts (1) the export
//     request it builds is byte-for-byte the committed `request`, and (2) the
//     canvas draw has exactly the slots the request sends — same labels, same
//     order, same count-label text, empty slots in the same places.
//   * tests/test_export_level_slots.py posts that SAME committed `request` to
//     the real /api/export/statplot-figure route and reads the SVG: tick
//     labels, the count labels sitting over their own ticks, no glyph on an
//     empty slot, the footnote.
//
// So "the screen and the export agree" is a chain with no hand-synced link:
// screen == request (here), request -> SVG (there).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import { statsBox } from "../../lib/api";
import type { DataStruct } from "../../lib/types";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(here, "../../../../tests/fixtures/wire/level_slots_statplot.json");

interface Fixture {
  dataset: Omit<DataStruct, "values"> & { values: (number | null)[][] };
  request: Record<string, unknown>;
  bar_request: Record<string, unknown>;
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Fixture;
const data: DataStruct = {
  ...fixture.dataset,
  values: fixture.dataset.values.map((row) => row.map((v) => (v === null ? NaN : v))),
};
// ONE dataset object, as the store hands the hook: a fresh `active` per render
// would re-key every memo and re-run the compute effect on each render.
const DS = { id: "fx", name: "fixture", data };
const Y_KEYS = [1]; // stable too, like the store's `yKeys`

beforeEach(() => {
  vi.resetAllMocks();
  // Offline: the client box-stats fallback, so no mock stats can mask a slot.
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

async function renderFixture() {
  const hook = renderHook(() =>
    useStatStage({
      active: DS,
      yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {},
    }),
  );
  act(() => {
    hook.result.current.setShowPoints(true);
    hook.result.current.setShowMeanCI(true);
    hook.result.current.setShowConnectMeans(true);
  });
  await waitFor(() => {
    const d = hook.result.current.draw;
    expect(d?.mode === "box" && d.points && d.boxes.length === 4).toBe(true);
  });
  return hook;
}

describe("level slots — interactive vs export parity (P2.6, A8 pattern)", () => {
  it("the export request the stage builds IS the committed shared fixture", async () => {
    const { result } = await renderFixture();
    await result.current.exportFigure("svg");
    expect(vi.mocked(exportStatplotFigure).mock.lastCall?.[0]).toEqual(fixture.request);
  });

  it("the canvas draw has exactly the request's slots, labels, count labels and empty positions", async () => {
    const { result } = await renderFixture();
    const d = result.current.draw;
    if (d?.mode !== "box" || !d.points) throw new Error("expected a box draw with points");
    const req = fixture.request as { labels: string[]; data: number[][]; count_labels: (string | null)[] };
    expect(d.boxes.map((b) => b.label)).toEqual(req.labels);
    expect(d.countLabels).toEqual(req.count_labels);
    expect(d.boxes.map((b) => b.n)).toEqual(req.data.map((g) => g.length));
    expect(d.points.map((g) => g.points.length)).toEqual(req.data.map((g) => g.length));
    // The fixture exercises all three facts at once: a normal slot, a caveated
    // (n < 3) slot, and two EMPTY slots — a NaN-only level and a declared-only one.
    expect(req.data.map((g) => g.length)).toEqual([12, 2, 0, 0]);
  });

  it("BAR: the categorical export request is the committed `bar_request`, and matches the canvas", async () => {
    const { result } = renderHook(() =>
      useStatStage({
        active: DS,
        yKeys: Y_KEYS, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {},
      }),
    );
    act(() => result.current.setMode("bar"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    await result.current.exportFigure("svg");
    const spec = vi.mocked(exportCategoricalFigure).mock.lastCall?.[0];
    // JSON round-trip: a NaN mean (an empty category) travels as null.
    expect(JSON.parse(JSON.stringify(spec))).toEqual(fixture.bar_request);
    const d = result.current.draw;
    if (d?.mode !== "bar") throw new Error("expected a bar draw");
    const req = fixture.bar_request as { groups: string[]; count_labels: (string | null)[] };
    expect(d.data.groups.map((g) => g.label)).toEqual(req.groups);
    expect(d.countLabels).toEqual(req.count_labels);
    expect(d.data.groups.map((g) => g.series[0].n)).toEqual([12, 2, 0, 0]);
  });
});
