import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePeakTableSelection } from "./peakSelection";

describe("usePeakTableSelection — click/ctrl/shift contract", () => {
  it("a plain click replaces the selection with just that row", () => {
    const source = [{}, {}, {}];
    const { result } = renderHook(() => usePeakTableSelection(source));

    act(() => result.current.select(1, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([1]));

    act(() => result.current.select(0, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([0])); // replaces, doesn't add
  });

  it("ctrl/cmd-click toggles a row without disturbing the rest", () => {
    const source = [{}, {}, {}];
    const { result } = renderHook(() => usePeakTableSelection(source));

    act(() => result.current.select(0, { shift: false, ctrlOrMeta: false }));
    act(() => result.current.select(2, { shift: false, ctrlOrMeta: true }));
    expect(result.current.selected).toEqual(new Set([0, 2]));

    act(() => result.current.select(2, { shift: false, ctrlOrMeta: true }));
    expect(result.current.selected).toEqual(new Set([0]));
  });

  it("shift-click extends a range from the last anchor without moving it", () => {
    const source = [{}, {}, {}, {}, {}];
    const { result } = renderHook(() => usePeakTableSelection(source));

    act(() => result.current.select(1, { shift: false, ctrlOrMeta: false })); // anchor = 1
    act(() => result.current.select(3, { shift: true, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([1, 2, 3]));

    // A second shift-click still extends from the SAME anchor (1), not from 3.
    act(() => result.current.select(0, { shift: true, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([0, 1]));
  });

  it("shift-click with no prior anchor selects just that row (anchor = itself)", () => {
    const source = [{}, {}, {}];
    const { result } = renderHook(() => usePeakTableSelection(source));

    act(() => result.current.select(2, { shift: true, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([2]));
  });
});

describe("usePeakTableSelection — RULING 2 (reset when the underlying result changes)", () => {
  it("a new `source` array reference clears any existing selection", () => {
    const sourceA = [{}, {}, {}];
    const { result, rerender } = renderHook(({ source }) => usePeakTableSelection(source), {
      initialProps: { source: sourceA },
    });
    act(() => result.current.select(1, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([1]));

    const sourceB = [{}, {}, {}]; // same length, DIFFERENT instance — e.g. a re-fit
    rerender({ source: sourceB });
    expect(result.current.selected).toEqual(new Set());
  });

  it("red-first repro (this lane's own evidence): a click landing in the very next commit after a source change never resurrects the stale selection", () => {
    // A useEffect-based reset (the pre-fix implementation) only clears AFTER
    // commit — strictly later than the render that first sees the new
    // `source`. This is exactly the sequence the integration-level
    // PeaksPanel.test.tsx red-first tests forced (two SEPARATE fireEvent
    // calls, i.e. two separate commits with no wait between them) and it
    // caught a real bug: the second commit's click still saw the STALE
    // anchor/selection because the effect hadn't flushed yet. Two distinct
    // `act()` calls here — no shared batch — mirror that real two-commit
    // sequence, rather than the invalid same-batch scenario that comes from
    // stuffing `rerender` and a stale-closure `select` call into one `act`.
    const sourceA = [{}, {}, {}];
    const { result, rerender } = renderHook(({ source }) => usePeakTableSelection(source), {
      initialProps: { source: sourceA },
    });
    act(() => result.current.select(0, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([0]));

    const sourceB = [{}, {}, {}]; // e.g. a fresh re-fit landing right after
    act(() => rerender({ source: sourceB }));
    expect(result.current.selected).toEqual(new Set()); // reset already applied, THIS commit

    act(() => result.current.select(2, { shift: true, ctrlOrMeta: false }));
    // The shift-click must extend from a FRESH anchor (index 2 only) — if the
    // reset hadn't already applied by render time, `anchorRef.current` would
    // still be 0 from before the source change, producing a bogus [0,1,2]
    // range built from a peak-0 that may no longer even exist in sourceB.
    expect(result.current.selected).toEqual(new Set([2]));
  });

  it("a dataset switch (peaks reset to a stable empty array, then repopulated) clears any stale selection", () => {
    const detected: unknown[] = [{}, {}];
    const { result, rerender } = renderHook(({ source }) => usePeakTableSelection(source), {
      initialProps: { source: detected },
    });
    act(() => result.current.select(1, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([1]));

    const EMPTY: unknown[] = [];
    rerender({ source: EMPTY }); // dataset switch — usePeaks resets `peaks` to []
    expect(result.current.selected).toEqual(new Set());

    const newDetected = [{}]; // the new dataset's own, unrelated peak(s)
    rerender({ source: newDetected });
    expect(result.current.selected).toEqual(new Set());
  });

  it("re-rendering with the SAME source reference keeps the selection (no spurious reset)", () => {
    const source = [{}, {}, {}];
    const { result, rerender } = renderHook(({ source }) => usePeakTableSelection(source), {
      initialProps: { source },
    });
    act(() => result.current.select(1, { shift: false, ctrlOrMeta: false }));
    rerender({ source }); // same reference — e.g. an unrelated sibling re-render
    expect(result.current.selected).toEqual(new Set([1]));
  });
});

describe("usePeakTableSelection — K1 (review round 2): `governs` clears a selection that loses governance, and never resurrects it", () => {
  it("losing governance (true -> false) clears the selection", () => {
    const source = [{}, {}, {}];
    const { result, rerender } = renderHook(
      ({ source, governs }) => usePeakTableSelection(source, governs),
      { initialProps: { source, governs: true } },
    );
    act(() => result.current.select(1, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([1]));

    rerender({ source, governs: false }); // e.g. a fit just appeared elsewhere
    expect(result.current.selected).toEqual(new Set());
  });

  it("red-first repro of the K1 mirror case: regaining governance does NOT resurrect the pre-loss selection", () => {
    const source = [{}, {}, {}];
    const { result, rerender } = renderHook(
      ({ source, governs }) => usePeakTableSelection(source, governs),
      { initialProps: { source, governs: true } },
    );
    act(() => result.current.select(0, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([0]));

    rerender({ source, governs: false }); // loses governance — cleared
    expect(result.current.selected).toEqual(new Set());
    rerender({ source, governs: true }); // regains governance — must STAY empty
    expect(result.current.selected).toEqual(new Set());
  });

  it("gaining governance for the FIRST time (initial render already governs) never clears a legitimately-made selection", () => {
    const source = [{}, {}, {}];
    const { result, rerender } = renderHook(
      ({ source, governs }) => usePeakTableSelection(source, governs),
      { initialProps: { source, governs: true } },
    );
    act(() => result.current.select(2, { shift: false, ctrlOrMeta: false }));
    rerender({ source, governs: true }); // re-render with governs unchanged (still true)
    expect(result.current.selected).toEqual(new Set([2]));
  });

  it("`governs` defaults to true (a caller that never passes it behaves exactly as before)", () => {
    const source = [{}, {}, {}];
    const { result } = renderHook(() => usePeakTableSelection(source));
    act(() => result.current.select(1, { shift: false, ctrlOrMeta: false }));
    expect(result.current.selected).toEqual(new Set([1]));
  });
});

describe("usePeakTableSelection — N3 (red-first): an unstable empty `source` must not crash the panel", () => {
  it("a caller that mints a FRESH [] every render (e.g. `fitResult?.peaks ?? []` written inline) does not throw 'Too many re-renders'", () => {
    // The render-phase reset (RULING 2) compares `source` by REFERENCE. A
    // caller who passes a brand-new `[]` literal on every call — the exact
    // inline form PeaksPanel.tsx's own NO_FITTED_PEAKS constant exists to
    // avoid — sees `source !== prevSource` on EVERY render, since a fresh
    // literal never equals the last one even though both are empty. Each
    // reset schedules a render-phase state update, which re-invokes this
    // same callback, which mints ANOTHER fresh `[]`... React caps this at a
    // fixed retry count and throws "Too many re-renders", taking the whole
    // panel down with it — not a "spurious reset", a crash.
    const { rerender } = renderHook(() => usePeakTableSelection([]));
    expect(() => rerender()).not.toThrow();
  });
});
