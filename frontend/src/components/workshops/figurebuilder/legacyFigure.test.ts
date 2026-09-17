import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSeriesPalette, TEST_SERIES_PALETTE } from "../../../lib/regressionMatrix.testkit";
import type { DataStruct } from "../../../lib/types";
import { buildLegacyFigureDoc, buildLegacyFigureSpec, type LegacyFigureState } from "./legacyFigure";

const DATA: DataStruct = {
  time: [0, 1],
  values: [
    [1, 9],
    [2, 8],
  ],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

const BASE: LegacyFigureState = {
  data: DATA,
  xKey: null,
  yKeys: null,
  xScale: "linear",
  yScale: "linear",
  xFmt: { mode: "auto", digits: 2 },
  yFmt: { mode: "auto", digits: 2 },
  style: "default",
  overrides: {},
  title: "",
  xLabel: "",
  yLabel: "",
  seriesStyles: {},
  docSeriesStyles: undefined,
  docGroupCol: null,
};

const IDENTITY = { id: "figd-1", name: "Saved", datasetId: "d1", live: true };
const OUTPUT = { fmt: "pdf", dpi: 300 };

describe("buildLegacyFigureSpec", () => {
  it("returns null with no data, so the caller renders nothing", () => {
    expect(buildLegacyFigureSpec({ ...BASE, data: null })).toBeNull();
  });

  it("omits x_fmt/y_fmt while both axes are auto (MAIN #24's lean-request rule)", () => {
    const spec = buildLegacyFigureSpec(BASE)!;
    expect(spec.x_fmt).toBeUndefined();
    expect(spec.y_fmt).toBeUndefined();
  });

  it("sends an explicit non-auto tick format", () => {
    const spec = buildLegacyFigureSpec({ ...BASE, xFmt: { mode: "sci", digits: 3 } })!;
    expect(spec.x_fmt).toEqual({ mode: "sci", digits: 3 });
  });

  it("carries both the scale enum and the legacy x_log/y_log booleans", () => {
    const spec = buildLegacyFigureSpec({ ...BASE, xScale: "log", yScale: "linear" })!;
    expect(spec.x_scale).toBe("log");
    expect(spec.x_log).toBe(true);
    expect(spec.y_log).toBe(false);
  });

  it("trims the title and drops blank axis labels rather than sending empty strings", () => {
    const spec = buildLegacyFigureSpec({ ...BASE, title: "  Loop  ", xLabel: "   ", yLabel: "M" })!;
    expect(spec.title).toBe("Loop");
    expect(spec.x_label).toBeUndefined();
    expect(spec.y_label).toBe("M");
  });

  // The three-way docSeriesStyles distinction is the subtle part of this
  // module: `undefined` mirrors the live plot, `null` is a saved doc that
  // explicitly carries none, and an array is that doc's own styles.
  it("mirrors live per-channel styles when no doc styles exist", () => {
    const spec = buildLegacyFigureSpec({ ...BASE, seriesStyles: { 0: { color: "#abcdef" } } })!;
    expect(spec.series_styles?.[0]).toMatchObject({ color: "#abcdef" });
  });

  it("sends a saved doc's own styles verbatim", () => {
    const docStyles = [{ color: "#123456", line: "none" as const, marker: true }];
    expect(buildLegacyFigureSpec({ ...BASE, docSeriesStyles: docStyles })!.series_styles).toEqual(docStyles);
  });

  it("omits series_styles entirely for an explicitly style-free doc", () => {
    // null must become `undefined` on the WIRE (an omitted field), not a null
    // the renderer would have to special-case.
    expect(buildLegacyFigureSpec({ ...BASE, docSeriesStyles: null })!.series_styles).toBeUndefined();
  });

  it("omits group_col unless the doc carries one", () => {
    expect(buildLegacyFigureSpec(BASE)!.group_col).toBeUndefined();
    expect(buildLegacyFigureSpec({ ...BASE, docGroupCol: 1 })!.group_col).toBe(1);
  });
});

describe("buildLegacyFigureDoc", () => {
  it("returns null with no data", () => {
    expect(buildLegacyFigureDoc({ ...BASE, data: null }, IDENTITY, OUTPUT)).toBeNull();
  });

  it("references the dataset by id for a live doc and carries no snapshot", () => {
    const doc = buildLegacyFigureDoc(BASE, IDENTITY, OUTPUT)!;
    expect(doc.live).toBe(true);
    expect(doc.datasetId).toBe("d1");
    expect(doc.dataSnapshot).toBeUndefined();
  });

  it("carries the data snapshot for a frozen doc, so it survives its dataset", () => {
    const doc = buildLegacyFigureDoc(BASE, { ...IDENTITY, live: false }, OUTPUT)!;
    expect(doc.dataSnapshot).toEqual(DATA);
  });

  it("keeps an explicitly style-free doc null — unlike the spec, which omits", () => {
    // The persisted config distinguishes "no styles" from "never had a doc";
    // the wire request does not. Both behaviours are load-bearing.
    expect(buildLegacyFigureDoc({ ...BASE, docSeriesStyles: null }, IDENTITY, OUTPUT)!.config.seriesStyles)
      .toBeNull();
  });

  it("persists the output format and DPI it was saved at, not a preset default", () => {
    const doc = buildLegacyFigureDoc(BASE, IDENTITY, { fmt: "svg", dpi: 600 })!;
    expect(doc.config.fmt).toBe("svg");
    expect(doc.config.dpi).toBe(600);
  });

  it("saves the UNTRIMMED title/labels the user typed, unlike the render request", () => {
    // A saved doc reopens into the same text fields it was saved from;
    // trimming belongs to the wire request, not the persisted config.
    const doc = buildLegacyFigureDoc({ ...BASE, title: "  Loop  " }, IDENTITY, OUTPUT)!;
    expect(doc.config.title).toBe("  Loop  ");
  });

  it("saves the same picks the preview renders", () => {
    const state: LegacyFigureState = { ...BASE, xKey: 0, yKeys: [1], docGroupCol: 2, xScale: "log" };
    const spec = buildLegacyFigureSpec(state)!;
    const config = buildLegacyFigureDoc(state, IDENTITY, OUTPUT)!.config;
    expect([config.xKey, config.yKeys, config.groupCol, config.xScale])
      .toEqual([spec.x_key, spec.y_keys, spec.group_col, spec.x_scale]);
  });
});

// ── BUG-016 on the LEGACY Publication Preview path ──────────────────────────
// The backend expands every `y_keys`-aligned entry onto its channel's
// per-level series, so this path must not send a colour the user never chose:
// one channel-aligned entry would paint EVERY level that one hue, while the
// canvas cycles the palette per level. Round 1 wired the flag here and pinned
// it nowhere (sabotaging it left the whole suite green — review F3); round 2
// found the saved-array branch bypassed it entirely (review F1).
describe("BUG-016 — a grouped legacy request's colour", () => {
  let restorePalette: () => void = () => {};
  beforeEach(() => {
    restorePalette = installSeriesPalette();
  });
  afterEach(() => restorePalette());

  const grouped = (over: Partial<LegacyFigureState>): LegacyFigureState =>
    ({ ...BASE, docGroupCol: 1, ...over });

  it("derives no palette colour for a grouped doc, and keeps the rest of the style", () => {
    const state = grouped({ seriesStyles: { 0: { width: 3, line: "dashed" } } });
    expect(buildLegacyFigureSpec(state)!.series_styles![0]).toEqual({ width: 3, line: "dashed" });
    // Control: the SAME state ungrouped bakes the slot in, so this is about
    // the flag and not about an unreadable palette.
    expect(buildLegacyFigureSpec({ ...state, docGroupCol: null })!.series_styles![0])
      .toEqual({ color: TEST_SERIES_PALETTE[0], width: 3, line: "dashed" });
  });

  it("still sends an EXPLICIT colour on a grouped doc — every level draws it", () => {
    const state = grouped({ seriesStyles: { 0: { color: "#ffe066", width: 3 } } });
    expect(buildLegacyFigureSpec(state)!.series_styles![0])
      .toEqual({ color: "#ffe066", width: 3 });
  });

  // The F1 path: a pre-BUG-016 saved doc, or a graph style template applied to
  // a grouped figure (`useGraphTemplates` builds its array flat, by design, so
  // it stays portable onto a flat figure). Both arrive as `docSeriesStyles`
  // with the palette slot already baked in.
  it("strips the palette colour a PINNED array carries on a grouped doc", () => {
    const pinned = [{ color: TEST_SERIES_PALETTE[0], width: 2, line: "dashed" as const }];
    expect(buildLegacyFigureSpec(grouped({ docSeriesStyles: pinned }))!.series_styles)
      .toEqual([{ width: 2, line: "dashed" }]);
  });

  it("keeps a PINNED explicit colour on a grouped doc", () => {
    const pinned = [{ color: "#ffe066", width: 2 }];
    expect(buildLegacyFigureSpec(grouped({ docSeriesStyles: pinned }))!.series_styles)
      .toEqual(pinned);
  });

  it("leaves a pinned array alone on a FLAT doc — the strip is grouped-only", () => {
    const pinned = [{ color: TEST_SERIES_PALETTE[0], width: 2 }];
    const spec = buildLegacyFigureSpec({ ...BASE, docGroupCol: null, docSeriesStyles: pinned })!;
    expect(spec.series_styles).toEqual(pinned);
  });

  it("saves what the preview renders: the stripped array reaches the doc too", () => {
    // The two builders share one `exportStyles` helper precisely so a saved
    // doc cannot reopen looking different from the preview it was saved from.
    const state = grouped({ docSeriesStyles: [{ color: TEST_SERIES_PALETTE[0], width: 2 }] });
    expect(buildLegacyFigureDoc(state, IDENTITY, OUTPUT)!.config.seriesStyles)
      .toEqual(buildLegacyFigureSpec(state)!.series_styles);
    expect(buildLegacyFigureDoc(state, IDENTITY, OUTPUT)!.config.seriesStyles)
      .toEqual([{ width: 2 }]);
  });
});
