// P3.4 zoom-refetch residual: a committed zoom/pan on a server-decimated
// payload should re-fetch just the visible window at full local detail (see
// usePlotPayload.ts's own header comment for the mechanism). `fetchPlot` is
// mocked (via the `importOriginal` partial-mock pattern already used
// elsewhere in this codebase) so every OTHER export of lib/plotdata.ts —
// composeDisplayPayload, categoricalXPayload, effectiveChannels, … — stays
// real; only the network boundary is faked.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ErrorBinding } from "../../lib/errorRoles";
import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const fetchPlotMock = vi.fn();
vi.mock("../../lib/plotdata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/plotdata")>()),
  fetchPlot: (...args: unknown[]) => fetchPlotMock(...args),
}));

function makeDataset(n: number): Dataset {
  return {
    id: "d1",
    name: "big",
    data: {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [Math.sin(i)]),
      labels: ["A"],
      units: [""],
      metadata: {},
    },
  };
}

// STABLE default references, built ONCE. `active`, `errKeys`, and
// `seriesStyles` all feed dependencies of the BASE fetch effect (`active`
// directly; `errKeys`/`seriesStyles` via the `errorBars`/`colorByColumns`
// `useMemo`s, which the effect depends on) — a helper minting a fresh `{}`
// per call would change those references on every `rerender` and trigger a
// spurious base re-fetch alongside whatever the test actually meant to
// exercise (xLim alone). In the real app these come from Zustand selectors,
// which are already reference-stable across renders; this mirrors that.
const DATASET = makeDataset(20_000);
const EMPTY_STYLES: PlotPayloadParams["seriesStyles"] = {};
const EMPTY_LABELS: PlotPayloadParams["seriesLabels"] = {};
const EMPTY_ERR_KEYS: PlotPayloadParams["errKeys"] = {};
const EMPTY_HIDDEN: PlotPayloadParams["hiddenChannels"] = [];

function baseParams(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: DATASET,
    yScale: "linear",
    xScale: "linear",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: EMPTY_STYLES,
    seriesLabels: EMPTY_LABELS,
    errKeys: EMPTY_ERR_KEYS,
    hiddenChannels: EMPTY_HIDDEN,
    waterfall: 0,
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
    xLim: null,
    ...overrides,
  };
}

function payloadFor(label: string, decimated: boolean, window: [number, number] | null = null): PlotPayload {
  return {
    data: [
      [0, 1, 2],
      [1, 2, 3],
    ] as PlotPayload["data"],
    series: [{ label, unit: "" }],
    xLabel: "x",
    xUnit: "",
    decimated,
    window,
  };
}

beforeEach(() => {
  fetchPlotMock.mockReset();
});

describe("usePlotPayload — P3.4 zoom-refetch residual", () => {
  it("fires a windowed re-fetch when a committed zoom lands on a server-decimated base", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);

    fetchPlotMock.mockResolvedValueOnce(payloadFor("windowed", true, [1, 2]));
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("windowed"));

    expect(fetchPlotMock).toHaveBeenCalledTimes(2);
    const [, , , , , , , xMin, xMax] = fetchPlotMock.mock.calls[1] as unknown[];
    expect(xMin).toBe(1);
    expect(xMax).toBe(2);
  });

  it("does NOT re-fetch on a committed zoom when the base was not server-decimated", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("small", false));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("small"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);

    rerender(baseParams({ xLim: [1, 2] }));
    await act(async () => {}); // give any errant effect a tick to fire
    expect(fetchPlotMock).toHaveBeenCalledTimes(1); // still just the one base fetch
    expect(result.current.payload?.series[0].label).toBe("small"); // untouched
  });

  it("pan (a second, different committed window) re-fetches through the SAME path as zoom", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    fetchPlotMock.mockResolvedValueOnce(payloadFor("zoomed", true, [1, 2]));
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("zoomed"));

    // A pan commits a DIFFERENT window through the identical `xLim` prop —
    // no special-casing needed for it to trigger the same re-fetch.
    fetchPlotMock.mockResolvedValueOnce(payloadFor("panned", true, [2, 3]));
    rerender(baseParams({ xLim: [2, 3] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("panned"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(3);
  });

  it("reset to full view (xLim -> null) restores the cached base payload with NO extra fetch", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    fetchPlotMock.mockResolvedValueOnce(payloadFor("windowed", true, [1, 2]));
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("windowed"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2);

    rerender(baseParams({ xLim: null }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2); // restored from the cached ref, no new call
  });

  it("a stale windowed response arriving after a reset never clobbers the restored full-range payload", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    // A windowed fetch that stays pending until resolved explicitly below —
    // simulates a slow response racing a subsequent reset.
    let resolveWindowed: ((v: PlotPayload) => void) | undefined;
    fetchPlotMock.mockImplementationOnce(
      () =>
        new Promise<PlotPayload>((resolve) => {
          resolveWindowed = resolve;
        }),
    );
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(fetchPlotMock).toHaveBeenCalledTimes(2));

    // The user resets to full view BEFORE the slow windowed response arrives.
    rerender(baseParams({ xLim: null }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    // The stale response finally resolves — it must be a no-op.
    await act(async () => {
      resolveWindowed?.(payloadFor("stale-windowed", true, [1, 2]));
    });
    expect(result.current.payload?.series[0].label).toBe("base"); // NOT clobbered
  });

  it("a stale windowed response superseded by a NEWER window commit never clobbers it either", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    let resolveFirstWindow: ((v: PlotPayload) => void) | undefined;
    fetchPlotMock.mockImplementationOnce(
      () =>
        new Promise<PlotPayload>((resolve) => {
          resolveFirstWindow = resolve;
        }),
    );
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(fetchPlotMock).toHaveBeenCalledTimes(2));

    // The user zooms again before the first windowed response lands.
    fetchPlotMock.mockResolvedValueOnce(payloadFor("second-window", true, [3, 4]));
    rerender(baseParams({ xLim: [3, 4] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("second-window"));

    // The stale FIRST window's response finally resolves — must not undo it.
    await act(async () => {
      resolveFirstWindow?.(payloadFor("stale-first-window", true, [1, 2]));
    });
    expect(result.current.payload?.series[0].label).toBe("second-window");
  });
});

// G4 (usePlotPayload error-honesty fix): a builder-created figure whose user
// EDITED an error binding (asymmetric pair, X-error, reassigned column) must
// render those edits in the real figure window, not just the builder
// preview. `documentErrors` (the focused window's document.bindings.errors,
// threaded in by PlotStage) becomes the authoritative input to
// `buildErrorSpans` IFF it contains at least one binding the legacy `errKeys`
// projection cannot express (`hasRichErrorBindings`); otherwise the existing
// `active.errorRoles` path stays byte-identical.
function errorDataset(): Dataset {
  return {
    id: "e1",
    name: "errs",
    data: {
      time: [0, 1, 2],
      values: [
        [10, 0.5, 0.3, 0.2],
        [20, 0.6, 0.4, 0.3],
        [30, 0.7, 0.5, 0.4],
      ],
      labels: ["signal", "eplus", "eminus", "legacy"],
      units: ["", "", "", ""],
      metadata: {},
    },
  };
}

const ASYMMETRIC_PAIR: ErrorBinding[] = [
  { channel: 1, target: 0, axis: "y", side: "+" },
  { channel: 2, target: 0, axis: "y", side: "-" },
];

function errorParams(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return baseParams({
    active: errorDataset(),
    yKeys: [0],
    ...overrides,
  });
}

describe("usePlotPayload — G4 figure-scoped error honesty", () => {
  beforeEach(() => {
    fetchPlotMock.mockResolvedValue(payloadFor("errs", false));
  });

  // t1 (RED-FIRST): a rich document binding NOT present in dataset.errorRoles
  // must still surface in errorSpans once the fix lands.
  it("surfaces an asymmetric pair from the focused window's document even when dataset.errorRoles doesn't have it", () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: errorParams({ documentErrors: ASYMMETRIC_PAIR }),
    });
    const spans = result.current.errorSpans.get(1);
    expect(spans).toBeDefined();
    expect(spans).toEqual([{ axis: "y", plus: [0.5, 0.6, 0.7], minus: [0.3, 0.4, 0.5] }]);
  });

  // t2, control: a legacy-only document (all y/both) on a dataset whose OWN
  // errorRoles carry the asymmetric pair -- spans still come from
  // dataset.errorRoles, unchanged behavior.
  it("control: a legacy-only document leaves dataset.errorRoles as the source of truth", () => {
    const ds = errorDataset();
    ds.errorRoles = ASYMMETRIC_PAIR;
    const legacyOnlyDocument: ErrorBinding[] = [{ channel: 3, target: 0, axis: "y", side: "both" }];
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: errorParams({ active: ds, documentErrors: legacyOnlyDocument }),
    });
    const spans = result.current.errorSpans.get(1);
    expect(spans).toEqual([{ axis: "y", plus: [0.5, 0.6, 0.7], minus: [0.3, 0.4, 0.5] }]);
  });

  // t3: the predicate's boundary -- document errors are all y/both (present,
  // non-empty) but the dataset carries NO errorRoles at all. If the fix
  // mistakenly activated on "document errors present" rather than "document
  // errors RICH", this would show the document's y/both binding; it must
  // stay empty instead, exactly like today's behavior with no document.
  it("boundary: document errors all y/both -> dataset path used (empty here, not the document's binding)", () => {
    const legacyOnlyDocument: ErrorBinding[] = [{ channel: 3, target: 0, axis: "y", side: "both" }];
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: errorParams({ documentErrors: legacyOnlyDocument }),
    });
    expect(result.current.errorSpans.size).toBe(0);
  });
});

// G4 review round, FIX 1 (P1, RED-FIRST): the decimation-eligibility gate
// used to read ONLY `active.errorRoles?.length`, blind to a focused
// window's own rich `documentErrors`. A >10,000-row dataset whose document
// carries rich errors on an EMPTY `errorRoles` passed the gate: the server
// bucket-decimated the payload while `buildErrorSpans` built full-resolution
// magnitude arrays, and `errorSpansPlugin` (uplotOverlays.ts) indexes those
// positionally against the (shorter, bucketed) xs -- silently wrong
// uncertainty bars, the exact misalignment `lib/plotDecimate.ts`'s error-bar
// doc comment warns about. `fetchPlotMock`'s 7th positional arg is
// `decimateWidth` (see `lib/plotdata.ts`'s `fetchPlot` signature) --
// non-null means a decimation request was actually sent.
function bigErrorDataset(withDatasetErrorRoles: boolean): Dataset {
  const n = 20_000;
  const ds: Dataset = {
    id: "big-err",
    name: "big-err",
    data: {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [Math.sin(i), 0.1, 0.1]),
      labels: ["signal", "eplus", "eminus"],
      units: ["", "", ""],
      metadata: {},
    },
  };
  if (withDatasetErrorRoles) {
    ds.errorRoles = [
      { channel: 1, target: 0, axis: "y", side: "+" },
      { channel: 2, target: 0, axis: "y", side: "-" },
    ];
  }
  return ds;
}

const BIG_RICH_ERRORS: ErrorBinding[] = [
  { channel: 1, target: 0, axis: "y", side: "+" },
  { channel: 2, target: 0, axis: "y", side: "-" },
];

describe("usePlotPayload — G4 review round: decimation gate honors document errors (P1 fix)", () => {
  beforeEach(() => {
    fetchPlotMock.mockResolvedValue(payloadFor("big-err", false));
  });

  // RED-FIRST: fails before the fix (decimateWidth was non-null — the gate
  // never consulted `documentErrors`).
  it("a rich document on a dataset with EMPTY errorRoles disables server decimation", () => {
    renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({
        active: bigErrorDataset(false),
        yKeys: [0],
        documentErrors: BIG_RICH_ERRORS,
      }),
    });
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);
    const decimateWidth = fetchPlotMock.mock.calls[0]?.[6];
    expect(decimateWidth).toBeNull();
  });

  // Control: the SAME rich errors, sourced from `dataset.errorRoles` instead
  // (the pre-existing path) — decimation was already, and stays, disabled.
  it("control: rich errors on dataset.errorRoles (no document) already disables decimation", () => {
    renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({ active: bigErrorDataset(true), yKeys: [0] }),
    });
    const decimateWidth = fetchPlotMock.mock.calls[0]?.[6];
    expect(decimateWidth).toBeNull();
  });

  // Control: no perf regression for plain windows — empty documentErrors AND
  // empty dataset.errorRoles on the same big dataset still decimates.
  it("control: empty documentErrors + empty errorRoles on a big dataset still decimates", () => {
    renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({ active: bigErrorDataset(false), yKeys: [0] }),
    });
    const decimateWidth = fetchPlotMock.mock.calls[0]?.[6];
    expect(decimateWidth).not.toBeNull();
  });

  // Control: a legacy-only (y/both) document on the same big, error-role-free
  // dataset must NOT disable decimation -- only RICH document errors do.
  it("control: a legacy-only document does not disable decimation", () => {
    const legacyOnly: ErrorBinding[] = [{ channel: 1, target: 0, axis: "y", side: "both" }];
    renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({
        active: bigErrorDataset(false),
        yKeys: [0],
        documentErrors: legacyOnly,
      }),
    });
    const decimateWidth = fetchPlotMock.mock.calls[0]?.[6];
    expect(decimateWidth).not.toBeNull();
  });
});
