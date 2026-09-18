import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildExportStyles } from "../../../lib/exportStyles";
import { sanitizeFigureDocs } from "../../../lib/figuredoc";
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
// found the saved-array branch bypassed it (F1) and fixed it by comparing
// against the live palette, which fails the moment the palette moves; round 3
// carries the answer on the entry (`colorDerived`) and applies it at the WIRE
// only, so "Save as figure" stops discarding the document's colour (F6).
describe("BUG-016 — a grouped legacy request's colour", () => {
  let restorePalette: () => void = () => {};
  beforeEach(() => {
    restorePalette = installSeriesPalette();
  });
  afterEach(() => restorePalette());

  const PALETTE_B = ["#112233", "#223344", "#334455", "#445566", "#556677", "#667788", "#778899", "#8899aa"];
  function flipTheme(): void {
    restorePalette();
    const root = document.documentElement;
    PALETTE_B.forEach((c, i) => root.style.setProperty(`--series-${i + 1}`, c));
    restorePalette = () => PALETTE_B.forEach((_c, i) => root.style.removeProperty(`--series-${i + 1}`));
  }

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

  // The pinned path: a saved doc reopened, or a graph style template applied
  // (`useGraphTemplates` builds its array FLAT by design, so it stays portable
  // onto a flat figure). Both arrive as `docSeriesStyles`, carrying whatever
  // colour the palette had at pin time.
  it("strips a PINNED derived colour on a grouped doc after a THEME FLIP", () => {
    const pinned = buildExportStyles([0], { 0: { width: 2, line: "dashed" } });
    flipTheme();
    expect(buildLegacyFigureSpec(grouped({ docSeriesStyles: pinned }))!.series_styles)
      .toEqual([{ width: 2, line: "dashed" }]);
  });

  it("keeps a PINNED explicit colour on a grouped doc after a theme flip", () => {
    const pinned = buildExportStyles([0], { 0: { color: "#ffe066", width: 2 } });
    flipTheme();
    expect(buildLegacyFigureSpec(grouped({ docSeriesStyles: pinned }))!.series_styles)
      .toEqual([{ color: "#ffe066", width: 2 }]);
  });

  it("leaves a pinned array's colour alone on a FLAT doc, palette switch included", () => {
    const pinned = buildExportStyles([0], { 0: { width: 2 } });
    flipTheme();
    expect(buildLegacyFigureSpec({ ...BASE, docGroupCol: null, docSeriesStyles: pinned })!.series_styles)
      .toEqual([{ color: TEST_SERIES_PALETTE[0], width: 2 }]);
  });

  it("SAVES a PINNED array's colour instead of the wire's (round-2 review F6)", () => {
    // Round 2 stripped inside the helper both builders share, so re-saving a
    // grouped figure wrote the STRIPPED array into `config.seriesStyles` —
    // the document's colour field destroyed on a save, permanently, for no
    // gain (the wire alone satisfies the same argument). The doc keeps colour
    // AND provenance now; only the request obeys the grouped rule.
    const pinned = buildExportStyles([0], { 0: { width: 2 } });
    const state = grouped({ yKeys: [0], docSeriesStyles: pinned });
    expect(buildLegacyFigureDoc(state, IDENTITY, OUTPUT)!.config.seriesStyles)
      .toEqual([{ color: TEST_SERIES_PALETTE[0], colorDerived: true, width: 2 }]);
    expect(buildLegacyFigureSpec(state)!.series_styles).toEqual([{ width: 2 }]);
  });

  it("a FLAT save re-opened GROUPED under a DIFFERENT palette still drops the derived colour", () => {
    // The whole point of persisting provenance, and round 2's F1 scenario end
    // to end on this path: the doc is saved flat (which is also how a graph
    // style template is built), the theme moves, and the figure is then
    // grouped. The round trip is stable because of the flag, not because the
    // palette held still.
    const saved = buildLegacyFigureDoc(
      { ...BASE, docGroupCol: null, yKeys: [0, 1], seriesStyles: { 1: { color: "#ffe066" } } },
      IDENTITY, OUTPUT,
    )!;
    expect(saved.config.seriesStyles).toEqual([
      { color: TEST_SERIES_PALETTE[0], colorDerived: true },
      { color: "#ffe066", colorDerived: false },
    ]);
    flipTheme();
    const reopened = grouped({ yKeys: [0, 1], docSeriesStyles: saved.config.seriesStyles });
    expect(buildLegacyFigureSpec(reopened)!.series_styles)
      .toEqual([null, { color: "#ffe066" }]);
  });

  // A PRE-PROVENANCE `.dwk` document, taken through the REAL load path
  // (`sanitizeFigureDocs` -> `migrateConfig`) rather than through the
  // sanitizer by hand. That distinction is the whole of review F3: round 3's
  // test called `sanitizeExportSeriesStyles` directly and claimed it was
  // "exactly as a workspace load would take it", while a `.dwk` FigureDoc's
  // `config` was in fact spread VERBATIM out of the JSON and never validated.
  describe("a `.dwk` document saved before provenance existed", () => {
    /** The literal persisted shape, including the two malformed flags review
     *  F3 measured flipping provenance on this path. */
    const dwkDoc = (styles: unknown): unknown => ({
      id: "figd-1",
      name: "Saved",
      datasetId: "d1",
      live: true,
      config: {
        xKey: null, yKeys: [0, 1], xScale: "linear", yScale: "linear",
        title: "", xLabel: "", yLabel: "", style: "default", fmt: "pdf", dpi: 300,
        overrides: null, seriesStyles: styles,
      },
    });
    const loadStyles = (styles: unknown): (typeof BASE)["docSeriesStyles"] =>
      sanitizeFigureDocs([dwkDoc(styles)], new Set(["d1"]))[0]!.config.seriesStyles;

    it("gains provenance AT LOAD, so the palette at export time cannot change the answer", () => {
      const restored = loadStyles([
        { color: TEST_SERIES_PALETTE[0], width: 2, line: "dashed" },
        { color: "#ffe066", width: 2 },
      ])!;
      expect(restored).toEqual([
        { color: TEST_SERIES_PALETTE[0], colorDerived: true, width: 2, line: "dashed" },
        { color: "#ffe066", colorDerived: false, width: 2 },
      ]);
      const wire = (): unknown =>
        buildLegacyFigureSpec(grouped({ yKeys: [0, 1], docSeriesStyles: restored }))!.series_styles;
      expect(wire()).toEqual([{ width: 2, line: "dashed" }, { color: "#ffe066", width: 2 }]);
      // Round 3's residual, RETIRED for a loaded document: the same array
      // under a palette that has since moved answers identically, where the
      // export-time comparison shipped the derived colour and painted every
      // level one hue.
      flipTheme();
      expect(wire()).toEqual([{ width: 2, line: "dashed" }, { color: "#ffe066", width: 2 }]);
    });

    it("treats a MALFORMED persisted flag as absent — review F3's two cases", () => {
      // `"no"` is truthy: round 3 read it as "the document says derived" and
      // dropped a colour the user CHOSE. `null` is falsy: read as "chosen",
      // shipping a derived colour — round 1's regression, back.
      expect(loadStyles([
        { color: "#ffe066", width: 2, colorDerived: "no" },
        { color: TEST_SERIES_PALETTE[1], width: 2, colorDerived: null },
      ])).toEqual([
        { color: "#ffe066", colorDerived: false, width: 2 },
        { color: TEST_SERIES_PALETTE[1], colorDerived: true, width: 2 },
      ]);
    });

    it("RE-SAVING writes the provenance it gained — the residual really does retire", () => {
      // Review F1: round 3 claimed this in three places and it was false.
      // `legacyFigure` returns `docSeriesStyles` verbatim when a doc seeded
      // it, so a reopened pre-provenance document re-persisted its flagless
      // array forever. It is true now because the ARRAY the builder holds
      // already carries the flag, assigned at load.
      const restored = loadStyles([{ color: TEST_SERIES_PALETTE[0], width: 2 }]);
      const resaved = buildLegacyFigureDoc(
        grouped({ yKeys: [0], docSeriesStyles: restored }), IDENTITY, OUTPUT,
      )!;
      expect(resaved.config.seriesStyles).toEqual([
        { color: TEST_SERIES_PALETTE[0], colorDerived: true, width: 2 },
      ]);
    });

    it("leaves a config with NO seriesStyles field exactly as it was", () => {
      const docs = sanitizeFigureDocs([dwkDoc(undefined)], new Set(["d1"]));
      expect(docs[0]!.config.seriesStyles).toBeUndefined();
      expect(sanitizeFigureDocs([dwkDoc(null)], new Set(["d1"]))[0]!.config.seriesStyles).toBeNull();
    });
  });

  it("sends no `colorDerived` on any legacy request", () => {
    const flat = buildLegacyFigureSpec({ ...BASE, seriesStyles: { 0: { width: 2 } } })!;
    const pinnedFlat = buildLegacyFigureSpec({
      ...BASE, docSeriesStyles: buildExportStyles([0], { 0: { width: 2 } }),
    })!;
    for (const entry of [...flat.series_styles!, ...pinnedFlat.series_styles!]) {
      expect(Object.keys(entry ?? {})).not.toContain("colorDerived");
    }
    expect(flat.series_styles![0]?.color).toBe(TEST_SERIES_PALETTE[0]); // non-vacuous
  });
});
