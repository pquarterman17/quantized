// Lane WB2 characterization: the live-preview contract of the three SIMS
// previewing hooks (Process, Compare, Region), written BEFORE they moved onto
// the shared workbench shell and kept as the guard after. Every race is
// forced with held requests and fake timers; nothing is waited out.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import { COMPARE_DELAY_MS, useSimsCompare } from "./useSimsCompare";
import { REGION_DELAY_MS, useSimsRegion } from "./useSimsRegion";
import { PREVIEW_DELAY_MS, useSims } from "./useSims";

vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn(), compareSims: vi.fn(), measureSimsRegion: vi.fn() }));
const api = await import("../../../lib/api/sims");

interface Held { signal?: AbortSignal; resolve: () => void; reject: (m: string) => void }
let held: Held[];
/** A request held open until the test answers it; `n` marks which call. */
function hold<T>(answer: (n: number) => T) {
  return (_body: unknown, signal?: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      const n = held.length;
      held.push({ signal, resolve: () => resolve(answer(n)), reject: (m) => reject(new Error(m)) });
    });
}

const profile: DataStruct = {
  time: [0, 10, 20, 30],
  values: [[1e18, 5e22], [3e18, 5e22], [5e18, 5e22], [3e18, 5e22]],
  labels: ["B", "Si"],
  units: ["atoms/cm3", "atoms/cm3"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm", technique: "sims" },
};
const tagged = (n: number): DataStruct => ({ ...profile, metadata: { ...profile.metadata, marker: n } });

interface Tool {
  name: string;
  delay: number;
  render: (active: boolean) => ReturnType<typeof renderHook<unknown, boolean>>;
  /** Two edits that each change the preview key. */
  edit: (cur: unknown, which: 1 | 2) => void;
  marker: (cur: unknown) => unknown;
  error: (cur: unknown) => string;
  loading: (cur: unknown) => boolean;
}

const tools: Tool[] = [
  {
    name: "Process (useSims)",
    delay: PREVIEW_DELAY_MS,
    // The default form has no stage on (nothing to preview): smoothing first.
    render: (a) => {
      const h = renderHook((active: boolean) => useSims(active), { initialProps: a });
      act(() => h.result.current.setForm({ smoothOn: true }));
      return h as never;
    },
    edit: (c, w) => (c as ReturnType<typeof useSims>).setForm({ calOn: true, calMethod: "rate", sputterRate: String(w) }),
    marker: (c) => (c as ReturnType<typeof useSims>).result?.data.metadata.marker,
    error: (c) => (c as ReturnType<typeof useSims>).previewError ?? "",
    loading: (c) => (c as ReturnType<typeof useSims>).loading,
  },
  {
    name: "Compare (useSimsCompare)",
    delay: COMPARE_DELAY_MS,
    render: (a) => renderHook((active: boolean) => useSimsCompare(active), { initialProps: a }) as never,
    edit: (c, w) => (c as ReturnType<typeof useSimsCompare>).toggleSpecies("Si", w === 2),
    marker: (c) => (c as ReturnType<typeof useSimsCompare>).result?.data.metadata.marker,
    error: (c) => (c as ReturnType<typeof useSimsCompare>).previewError ?? "",
    loading: (c) => (c as ReturnType<typeof useSimsCompare>).loading,
  },
  {
    name: "Region (useSimsRegion)",
    delay: REGION_DELAY_MS,
    render: (a) => renderHook((active: boolean) => useSimsRegion(active), { initialProps: a }) as never,
    edit: (c, w) => (c as ReturnType<typeof useSimsRegion>).setForm({ threshold: String(w * 10) }),
    marker: (c) => (c as ReturnType<typeof useSimsRegion>).result?.csv,
    error: (c) => (c as ReturnType<typeof useSimsRegion>).previewError ?? "",
    loading: (c) => (c as ReturnType<typeof useSimsRegion>).loading,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  held = [];
  vi.mocked(api.processSims).mockImplementation(hold((n) => ({
    dataset: tagged(n), warnings: [], stages: [],
  })) as never);
  vi.mocked(api.compareSims).mockImplementation(hold((n) => ({
    dataset: { ...tagged(n), labels: ["B"], values: [[1], [2], [3], [4]] }, warnings: [], traces: [{ label: "B" }],
  })) as never);
  vi.mocked(api.measureSimsRegion).mockImplementation(hold((n) => ({
    region: [0, 30], x_name: "Depth", x_unit: "nm", rows_in_region: 4,
    method: { threshold_mode: "fraction", threshold: 0.5 }, species: [], warnings: [], csv: `call-${n}`,
  })) as never);
  useApp.setState({
    datasets: [{ id: "s1", name: "a.csv", data: profile }],
    folders: [], activeId: "s1", selectedIds: ["s1"], macroRecording: false, macroSteps: [],
  });
  useSimsDialog.setState({ seed: "s1", opened: 1 });
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe.each(tools)("$name live preview contract", (t) => {
  it("debounces by its delay and is loading until the answer lands", async () => {
    const h = t.render(true);
    expect(t.loading(h.result.current)).toBe(true);
    tick(t.delay - 1);
    expect(held).toHaveLength(0);
    tick(1);
    expect(held).toHaveLength(1);
    expect(t.loading(h.result.current)).toBe(true);
    held[0].resolve();
    await flush();
    expect(t.loading(h.result.current)).toBe(false);
    expect(t.marker(h.result.current)).toBeDefined();
  });

  it("fires nothing while its tab is hidden", () => {
    const h = t.render(false);
    tick(t.delay * 4);
    expect(held).toHaveLength(0);
    expect(t.loading(h.result.current)).toBe(false);
  });

  it("aborts the request in flight on an edit and never shows its late answer", async () => {
    const h = t.render(true);
    tick(t.delay);
    act(() => t.edit(h.result.current, 1));
    tick(t.delay);
    const [first, second] = [held[0], held[1]];
    // The first (initial-key) request was aborted by the edit.
    expect(first.signal?.aborted).toBe(true);
    // Answer the live request, then the stale one lands last.
    const before = held.length;
    held[before - 1].resolve();
    await flush();
    const shown = t.marker(h.result.current);
    expect(shown).toBeDefined();
    first.resolve();
    await flush();
    expect(t.marker(h.result.current)).toBe(shown);
    expect(second).toBeDefined();
  });

  it("aborts the request in flight on unmount", () => {
    const h = t.render(true);
    tick(t.delay);
    h.unmount();
    expect(held[0].signal?.aborted).toBe(true);
  });

  it("shows a failure for the current inputs and clears it on the next edit", async () => {
    const h = t.render(true);
    tick(t.delay);
    held[0].reject("boom");
    await flush();
    expect(t.error(h.result.current)).toBe("boom");
    expect(t.loading(h.result.current)).toBe(false);
    act(() => t.edit(h.result.current, 1));
    expect(t.error(h.result.current)).toBe("");
    expect(t.loading(h.result.current)).toBe(true);
  });

  it("an answer for the previous inputs is not the preview of the new ones", async () => {
    const h = t.render(true);
    tick(t.delay);
    held[0].resolve();
    await flush();
    const first = t.marker(h.result.current);
    expect(first).toBeDefined();
    act(() => t.edit(h.result.current, 1));
    expect(t.marker(h.result.current)).toBeUndefined();
  });
});
