// The Stat Stage's significance marks hook (gap audit 8 lane SIG): opt-in (off
// = no request, draw untouched), the existing Tukey / Dunnett endpoints, and
// every ambiguous request fails closed with a stated reason.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsTukey } from "../../lib/api";
import { statsDunnett } from "../../lib/api/statsTests";
import { resolveStatMarks, type ResolvedStatMarks } from "../../lib/statMarks";
import { boxStatsClient } from "../../lib/statstage";
import type { StatDrawData } from "./statRender";
import { useStatComparisons, type StatComparisonsParams } from "./useStatComparisons";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsTukey: vi.fn(),
}));
vi.mock("../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/statsTests")>()),
  statsDunnett: vi.fn(),
}));

const GROUPS = [
  { label: "a", values: [1, 2, 3] },
  { label: "b", values: [4, 5, 6] },
  { label: "c", values: [9, 10, 11] },
];
const boxes = GROUPS.map((g) => ({ ...boxStatsClient(g.values), label: g.label }));
const DRAW: StatDrawData = { mode: "box", boxes, valueLabel: "y", groupLabel: "g" };
const marks = (m: Partial<ResolvedStatMarks>) => ({ ...resolveStatMarks("box", {}), ...m });

function params(over: Partial<StatComparisonsParams> = {}): StatComparisonsParams {
  return {
    mode: "box", marks: marks({}), draw: DRAW, faceted: false, groups: GROUPS, data: null,
    groupCol: 0, valueCol: 1, plotted: [1], barSeries: 1, barStack: false, ...over,
  };
}
const tukey = (pairs: { i: number; j: number; p: number }[]) => vi.mocked(statsTukey).mockResolvedValue({ pairs });

beforeEach(() => {
  vi.mocked(statsTukey).mockReset();
  vi.mocked(statsDunnett).mockReset();
});

describe("off", () => {
  it("makes no request and returns the draw untouched", () => {
    const { result } = renderHook(() => useStatComparisons(params()));
    expect(result.current.draw).toBe(DRAW);
    expect(result.current.note).toBeNull();
    expect(result.current.error).toBeNull();
    expect(statsTukey).not.toHaveBeenCalled();
    expect(statsDunnett).not.toHaveBeenCalled();
  });
});

describe("Tukey brackets", () => {
  it("sends the plotted groups and stamps the laid-out brackets and the note", async () => {
    tukey([{ i: 0, j: 1, p: 0.2 }, { i: 0, j: 2, p: 0.0003 }, { i: 1, j: 2, p: 0.04 }]);
    const { result } = renderHook(() => useStatComparisons(params({ marks: marks({ comparisons: "brackets" }) })));
    await waitFor(() => expect(result.current.note).not.toBeNull());
    expect(vi.mocked(statsTukey).mock.calls[0]).toEqual([GROUPS.map((g) => g.values), 0.05]);
    const d = result.current.draw as Extract<StatDrawData, { mode: "box" }>;
    expect(d.comparisons?.brackets.map((b) => [b.a, b.b, b.label])).toEqual([[1, 2, "*"], [0, 2, "***"]]);
    expect(result.current.note).toContain("Tukey HSD");
    expect(result.current.labels).toEqual(["a", "b", "c"]);
    expect(result.current.error).toBeNull();
  });
});

describe("Tukey letters", () => {
  it("stamps one letter per group", async () => {
    tukey([{ i: 0, j: 1, p: 0.001 }, { i: 0, j: 2, p: 0.001 }, { i: 1, j: 2, p: 0.001 }]);
    const { result } = renderHook(() => useStatComparisons(params({ marks: marks({ comparisons: "letters" }) })));
    await waitFor(() => expect(result.current.note).not.toBeNull());
    const d = result.current.draw as Extract<StatDrawData, { mode: "box" }>;
    expect(d.comparisons?.letters.map((l) => l.text)).toEqual(["c", "b", "a"]);
    expect(result.current.note).toContain("sharing a letter");
  });
});

describe("Dunnett", () => {
  it("compares each group to the picked control", async () => {
    vi.mocked(statsDunnett).mockResolvedValue({
      comparisons: [{ group: 0, diff: -5, statistic: 0, p: 0.001, ciLow: null, ciHigh: null, significant: true },
        { group: 2, diff: 5, statistic: 0, p: 0.2, ciLow: null, ciHigh: null, significant: false }],
      control: 1, alpha: 0.05, alternative: "two-sided", method: "Dunnett",
    });
    const m = marks({ comparisons: "brackets", compareMethod: "dunnett", compareControl: "b" });
    const { result } = renderHook(() => useStatComparisons(params({ marks: m })));
    await waitFor(() => expect(result.current.note).not.toBeNull());
    expect(vi.mocked(statsDunnett).mock.calls[0][0]).toMatchObject({ control: 1, alpha: 0.05, alternative: "two-sided" });
    const d = result.current.draw as Extract<StatDrawData, { mode: "box" }>;
    expect(d.comparisons?.brackets.map((b) => [b.a, b.b, b.label])).toEqual([[0, 1, "**"]]);
    expect(result.current.note).toContain('Dunnett vs control "b"');
  });

  it("defaults the control to the first group", async () => {
    vi.mocked(statsDunnett).mockResolvedValue({ comparisons: [{ group: 1, diff: 0, statistic: 0, p: 0.5, ciLow: null, ciHigh: null, significant: false }], control: 0, alpha: 0.05, alternative: "two-sided", method: "Dunnett" });
    const { result } = renderHook(() => useStatComparisons(params({ marks: marks({ comparisons: "brackets", compareMethod: "dunnett" }) })));
    await waitFor(() => expect(result.current.note).not.toBeNull());
    expect(vi.mocked(statsDunnett).mock.calls[0][0]).toMatchObject({ control: 0 });
  });

  it("refuses a control that is no longer a group, drawing nothing", async () => {
    const m = marks({ comparisons: "brackets", compareMethod: "dunnett", compareControl: "gone" });
    const { result } = renderHook(() => useStatComparisons(params({ marks: m })));
    await waitFor(() => expect(result.current.error).toContain("gone"));
    expect((result.current.draw as { comparisons?: unknown }).comparisons).toBeUndefined();
    expect(statsDunnett).not.toHaveBeenCalled();
  });
});

describe("refusals draw nothing and say why", () => {
  const on = marks({ comparisons: "brackets" });
  const none = (r: { current: { draw: StatDrawData | null } }) => expect((r.current.draw as { comparisons?: unknown }).comparisons).toBeUndefined();

  it("letters with Dunnett", () => {
    const { result } = renderHook(() => useStatComparisons(params({ marks: marks({ comparisons: "letters", compareMethod: "dunnett" }) })));
    expect(result.current.error).toMatch(/Tukey/);
    none(result);
    expect(statsDunnett).not.toHaveBeenCalled();
  });

  it("a faceted plot", () => {
    const { result } = renderHook(() => useStatComparisons(params({ marks: on, faceted: true })));
    expect(result.current.error).toMatch(/faceted/);
    expect(statsTukey).not.toHaveBeenCalled();
  });

  it("one group, and a group with a single value", () => {
    const one = renderHook(() => useStatComparisons(params({ marks: on, groups: GROUPS.slice(0, 1) })));
    expect(one.result.current.error).toMatch(/at least 2 groups/);
    const small = renderHook(() => useStatComparisons(params({ marks: on, groups: [GROUPS[0], { label: "tiny", values: [5] }] })));
    expect(small.result.current.error).toMatch(/"tiny" has 1/);
    expect(statsTukey).not.toHaveBeenCalled();
  });

  it("stacked bars, several series, no group column", () => {
    for (const over of [{ barStack: true }, { barSeries: 2 }, { groupCol: null }]) {
      const { result } = renderHook(() => useStatComparisons(params({ mode: "bar", marks: on, ...over })));
      expect(result.current.error).toMatch(/grouped bars, one series/);
    }
    expect(statsTukey).not.toHaveBeenCalled();
  });

  it("a request that fails", async () => {
    vi.mocked(statsTukey).mockRejectedValue(new Error("backend down"));
    const { result } = renderHook(() => useStatComparisons(params({ marks: on })));
    await waitFor(() => expect(result.current.error).toBe("backend down"));
    none(result);
  });

  it("a draw that is not the one the test ran on", async () => {
    tukey([{ i: 0, j: 2, p: 0.001 }]);
    const stale: StatDrawData = { ...DRAW, boxes: boxes.slice(0, 2) } as StatDrawData;
    const { result } = renderHook(() => useStatComparisons(params({ marks: on, draw: stale })));
    await waitFor(() => expect(result.current.error).toMatch(/changed/));
    none(result);
  });

  it("p-values that are not usable", async () => {
    tukey([{ i: 0, j: 1, p: NaN }]);
    const { result } = renderHook(() => useStatComparisons(params({ marks: on })));
    await waitFor(() => expect(result.current.error).toMatch(/no usable p-values/));
  });
});

describe("changing the option", () => {
  it("drops the marks when turned off again", async () => {
    tukey([{ i: 0, j: 2, p: 0.001 }]);
    const { result, rerender } = renderHook((p: StatComparisonsParams) => useStatComparisons(p), {
      initialProps: params({ marks: marks({ comparisons: "brackets" }) }),
    });
    await waitFor(() => expect(result.current.note).not.toBeNull());
    act(() => rerender(params()));
    expect(result.current.note).toBeNull();
    expect(result.current.draw).toBe(DRAW);
  });
});
