import { describe, expect, it } from "vitest";

import {
  resolveSecondaryAxis,
  secondaryAxisFromPanel,
  secondaryAxisFromView,
  secondaryAxisIsLog,
  secondaryAxisWire,
  type SecondaryAxisSpec,
} from "./axisspec";
import type { SpatialPanel } from "./multipanel";
import type { AxisFormat } from "./types";

const AUTO: AxisFormat = { mode: "auto", digits: 2 };
const SCI: AxisFormat = { mode: "sci", digits: 3 };

function spec(overrides: Partial<SecondaryAxisSpec> = {}): SecondaryAxisSpec {
  return {
    keys: [2],
    lim: null,
    scale: null,
    step: null,
    fmt: null,
    label: "",
    ...overrides,
  };
}

function panel(overrides: Partial<SpatialPanel> = {}): SpatialPanel {
  return {
    datasetId: "ds1",
    xKey: 0,
    yKeys: [1, 2],
    xLim: [0, 1],
    yLim: [0, 1],
    xLog: false,
    yLog: false,
    row: 0,
    col: 0,
    ...overrides,
  };
}

describe("resolveSecondaryAxis", () => {
  it("returns null when nothing plotted rides the secondary axis", () => {
    expect(resolveSecondaryAxis([1, 2], spec({ keys: null }), { scale: "linear", fmt: AUTO }))
      .toBeNull();
    expect(resolveSecondaryAxis([1, 2], spec({ keys: [] }), { scale: "linear", fmt: AUTO }))
      .toBeNull();
    // Membership names a channel that is not plotted (hidden/filtered out) —
    // there is no y2 axis to draw, which is the gate every consumer branches on.
    expect(resolveSecondaryAxis([1], spec({ keys: [2] }), { scale: "linear", fmt: AUTO }))
      .toBeNull();
  });

  it("intersects membership with the plotted list IN DISPLAY ORDER, not save order", () => {
    // `keys` is deliberately descending; the result must follow `plotted`.
    const axis = resolveSecondaryAxis(
      [5, 1, 3],
      spec({ keys: [3, 5] }),
      { scale: "linear", fmt: AUTO },
    );
    expect(axis!.keys).toEqual([5, 3]);
  });

  it("inherits the primary scale and format when null, and honors an explicit one", () => {
    const inherited = resolveSecondaryAxis([2], spec(), { scale: "log", fmt: SCI })!;
    expect(inherited.scale).toBe("log");
    expect(inherited.fmt).toEqual(SCI);

    const explicit = resolveSecondaryAxis(
      [2],
      spec({ scale: "linear", fmt: AUTO }),
      { scale: "log", fmt: SCI },
    )!;
    expect(explicit.scale).toBe("linear");
    expect(explicit.fmt).toEqual(AUTO);
  });

  it("normalizes a blank/whitespace label to null so the backend auto-derives one", () => {
    expect(resolveSecondaryAxis([2], spec({ label: "" }), { scale: "linear", fmt: AUTO })!.label)
      .toBeNull();
    expect(resolveSecondaryAxis([2], spec({ label: "   " }), { scale: "linear", fmt: AUTO })!.label)
      .toBeNull();
    expect(
      resolveSecondaryAxis([2], spec({ label: "  SLD  " }), { scale: "linear", fmt: AUTO })!.label,
    ).toBe("SLD");
  });

  it("passes lim and step through untouched", () => {
    const axis = resolveSecondaryAxis(
      [2],
      spec({ lim: [1, 100], step: 25 }),
      { scale: "linear", fmt: AUTO },
    )!;
    expect(axis.lim).toEqual([1, 100]);
    expect(axis.step).toBe(25);
  });
});

describe("secondaryAxisIsLog", () => {
  it("is false without an axis and tracks the RESOLVED scale, not the raw spec", () => {
    expect(secondaryAxisIsLog(null)).toBe(false);
    // scale null + a log primary => inherited log => minor ticks are needed.
    expect(
      secondaryAxisIsLog(resolveSecondaryAxis([2], spec(), { scale: "log", fmt: AUTO })),
    ).toBe(true);
    expect(
      secondaryAxisIsLog(
        resolveSecondaryAxis([2], spec({ scale: "linear" }), { scale: "log", fmt: AUTO }),
      ),
    ).toBe(false);
  });
});

describe("secondaryAxisWire", () => {
  it("spreads to nothing when there is no secondary axis", () => {
    expect(secondaryAxisWire(null)).toEqual({});
  });

  it("omits y2_label when blank and y2_fmt when the resolved format is auto", () => {
    const wire = secondaryAxisWire(
      resolveSecondaryAxis([2], spec(), { scale: "linear", fmt: AUTO }),
    );
    expect(wire.y2_keys).toEqual([2]);
    expect(wire.y2_scale).toBe("linear");
    expect("y2_label" in wire).toBe(false);
    expect(wire.y2_fmt).toBeUndefined();
  });

  it("sends the inherited format so the backend does not have to inherit", () => {
    // The backend has no inherit rule (calc/figure_y2.draw_secondary_axes
    // passes y_fmt straight through; None = no formatter), so the resolved
    // value has to reach the wire or the secondary axis renders unformatted.
    const wire = secondaryAxisWire(
      resolveSecondaryAxis([2], spec({ label: "SLD" }), { scale: "log", fmt: SCI }),
    );
    expect(wire.y2_fmt).toEqual(SCI);
    expect(wire.y2_scale).toBe("log");
    expect(wire.y2_label).toBe("SLD");
  });
});

describe("adapters collapse the mirrored representations", () => {
  it("a PlotView/store view maps its six fields straight across", () => {
    expect(
      secondaryAxisFromView({
        y2Keys: [3],
        y2Lim: [0, 5],
        y2Scale: "log",
        y2Step: 1,
        y2Fmt: SCI,
        y2AxisLabel: "M",
      }),
    ).toEqual({ keys: [3], lim: [0, 5], scale: "log", step: 1, fmt: SCI, label: "M" });
  });

  it("a SpatialPanel's y2Log boolean bridges to an AxisScale", () => {
    expect(secondaryAxisFromPanel(panel({ y2Keys: [2], y2Log: true })).scale).toBe("log");
    expect(secondaryAxisFromPanel(panel({ y2Keys: [2], y2Log: false })).scale).toBe("linear");
    // Undecoded (absent) => null => inherit the primary, which is what the
    // on-screen multi-panel render already does (useMultiPanelStage's
    // `p.y2Log != null ? scaleFromLog(p.y2Log) : null`). Screen and export
    // now reach that answer through the SAME code instead of two copies.
    expect(secondaryAxisFromPanel(panel({ y2Keys: [2] })).scale).toBeNull();
  });

  it("a SpatialPanel has no y2 format of its own, so it always inherits", () => {
    // This null is the whole bug fix: it is what makes the page export pick
    // up the page's primary Y format for the secondary axis.
    expect(secondaryAxisFromPanel(panel({ y2Keys: [2] })).fmt).toBeNull();
  });

  it("absent optional panel fields normalize to null rather than undefined", () => {
    const s = secondaryAxisFromPanel(panel());
    expect(s).toEqual({ keys: null, lim: null, scale: null, step: null, fmt: null, label: "" });
  });
});
