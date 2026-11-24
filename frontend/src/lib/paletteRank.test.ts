// The ⌘K ranker. Two layers: a BENCHMARK table of real things a scientist
// types, run against the REAL command registry (so a rewritten label or a
// dropped keyword fails here, not in front of a user); and focused unit tests
// of each ranking rule on synthetic commands.
import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import type { Action } from "../store/commands";
import { useApp } from "../store/useApp";
import { contextPaletteActions } from "./paletteContextActions";
import { rankActions } from "./paletteRank";
import { PALETTE_SYNONYMS, synonymPhrases } from "./paletteSynonyms";

// The palette also merges the active dataset's context actions (Rename…, Duplicate,
// Delete permanently…), so the benchmark ranks them together with the menu commands.
useApp.setState({ datasets: [{ id: "d1", name: "Alpha", data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} } }], activeId: "d1" });
const REAL = [...buildAppActions(useApp.getState), ...contextPaletteActions()];

interface Row {
  q: string;
  /** The id at rank 1, or a pattern for a family whose members tie. */
  first: string | RegExp;
  /** Ids that must ALL appear in the top three. */
  top3?: string[];
  /** Every one of the top three must match (a family query). */
  family?: RegExp;
  /** Ids that must NOT be first (a regression guard). */
  notFirst?: string[];
  /** Fewer results than this (a noisy query stays bounded). */
  maxResults?: number;
}

// The three failures that started this (2026-11): "fit" ranked Film thickness
// (FFT) first, "export pdf" found nothing, "error bar" returned Ternary diagram.
const BENCHMARK: Row[] = [
  // Fitting tools before layout: "Multi-panel fit (letterbox)" is a layout command, so the
  // surface / ellipse fits may outrank it on a bare "fit" (lane I).
  { q: "fit", first: "curvefit", top3: ["curvefit", "fit-y-by-x"] },
  { q: "surface fit", first: "surface-fit" },
  { q: "ellipse fit", first: "ellipse-fit" },
  { q: "tauc", first: "optical-gap" },
  { q: "band gap", first: "optical-gap" },
  { q: "fitting", first: "curvefit" },
  { q: "export pdf", first: "export-pdf", top3: ["export-pdf", "export-figure"] },
  { q: "pdf", first: "export-pdf", top3: ["export-figure"] },
  { q: "export svg", first: "export-svg", top3: ["export-figure"] },
  { q: "svg", first: "export-svg" },
  { q: "error bar", first: "error-bars" },
  { q: "error bars", first: "error-bars" },
  { q: "errors", first: "error-bars" },
  { q: "uncertainty", first: "error-bars" },
  { q: "normalize", first: /^signal-normalize-/, family: /^signal-normalize-/ },
  { q: "normalise", first: /^signal-normalize-/, family: /^signal-normalize-/ },
  { q: "norm", first: /^signal-normalize-/, family: /^signal-normalize-/ },
  { q: "derivative", first: /^signal-derivative/, family: /^signal-derivative/ },
  { q: "differentiate", first: /^signal-derivative/, family: /^signal-derivative/ },
  { q: "deriv", first: /^signal-derivative/, family: /^signal-derivative/ },
  { q: "integrate", first: "signal-integrate" },
  { q: "integral", first: "signal-integrate" },
  { q: "area under curve", first: "signal-integrate" },
  { q: "smooth", first: "signal-smooth" },
  { q: "smoothing", first: "signal-smooth" },
  { q: "denoise", first: "signal-smooth" },
  { q: "detrend", first: "signal-detrend" },
  { q: "despike", first: "signal-despike" },
  { q: "cosmic ray", first: /^signal-(despike|processing)$/, top3: ["signal-despike", "signal-processing"] },
  { q: "subtract background", first: "baseline", top3: ["baseline"] },
  { q: "background", first: "baseline" },
  { q: "baseline", first: "baseline" },
  { q: "log scale", first: "scale-y-log", top3: ["scale-y-log", "scale-x-log", "yLog"] },
  { q: "log y", first: "scale-y-log" },
  { q: "linear y", first: "scale-y-linear" },
  { q: "fft", first: "signal-fft", top3: ["signal-fft", "reductions-fft", "reductions-reflfft"] },
  { q: "peaks", first: "peaks" },
  { q: "hysteresis", first: "hysteresis" },
  { q: "reflectivity", first: /^(reflectivity|reductions-reflfft)$/ },
  { q: "kiessig", first: "reductions-fft" },
  { q: "ternary", first: "ternary-figure" },
  { q: "t test", first: "stats-chooser", top3: ["stats-chooser", "stats-tests"] },
  { q: "import", first: "import" },
  { q: "theme", first: "theme" },
  { q: "sample", first: "load-sample" },
  { q: "demo", first: "demo" },
  // Review M2: "setup" must not stem to "set", and "the" in a description must not match "theme".
  { q: "setup", first: "page-setup", notFirst: ["graph-template-default"] },
  { q: "plot setup", first: "page-setup", notFirst: ["graph-template-default", "graph-builder"] },
  { q: "theme", first: "theme", maxResults: 20 },
  { q: "then", first: /.*/, maxResults: 12 },
  { q: "sets", first: /.*/, notFirst: [] },
  // Review S2: filler words are optional; a loose match cannot carry a multi-word query.
  { q: "smooth data", first: "signal-smooth" },
  { q: "smooth the data", first: "signal-smooth" },
  { q: "import data", first: "import" },
  // UX audit 8 #6: the vocabulary of daily jobs.
  { q: "save", first: "save-workspace-quick", notFirst: ["graph-template-save"] },
  { q: "linear fit", first: "curvefit", notFirst: ["optical-gap"] },
  { q: "gaussian", first: "curvefit", top3: ["curvefit"] },
  { q: "set column values", first: "set-column-values" },
  { q: "subtract dataset", first: "dataset-math" },
  { q: "difference", first: "dataset-math" },
  { q: "dataset algebra", first: "dataset-math" },
  { q: "FC minus ZFC", first: "dataset-math" },
  { q: "dataset math", first: "dataset-math" },
  { q: "font size", first: "figure-builder" },
  { q: "nature", first: "export-figure" },
  { q: "aps", first: "export-figure" },
  { q: "tc", first: "peaks" },
  { q: "peak position", first: "peaks" },
  { q: "units convert", first: "calculators" },
  { q: "axis range", first: "axis-dialog" },
  { q: "annotate", first: /^insert-(textbox|arrow)$/, top3: ["insert-textbox", "insert-arrow"] },
  { q: "copy figure", first: "copy-figure" },
  { q: "batch", first: /^(curvefit|peaks)$/, top3: ["curvefit", "peaks"] },
  { q: "zzzz qqqq", first: /.*/, maxResults: 0 },
  // Origin vocabulary.
  { q: "layer contents", first: "layer-contents" },
  { q: "peak analyzer", first: "peak-wizard" },
  { q: "nonlinear curve fit", first: "curvefit" },
  { q: "recalculate", first: "recalc-now" },
  // Menu / context commands that ride the palette.
  { q: "rename", first: /^ctx\.dataset\..*rename$/ },
  { q: "delete", first: /^(ctx\.dataset\..*deletePermanently|edit-delete)$/, top3: ["edit-delete"] },
  { q: "duplicate", first: /^(ctx\.dataset\.dataset\.duplicate|duplicate)$/ },
];

describe("palette ranking benchmark (real commands)", () => {
  it.each(BENCHMARK)("$q", ({ q, first, top3, family, notFirst, maxResults }) => {
    const all = rankActions(REAL, q);
    const ids = all.slice(0, 3).map((r) => r.a.id);
    if (maxResults !== undefined) expect(all.length).toBeLessThanOrEqual(maxResults);
    if (maxResults === undefined) expect(all.length, "a benchmark query must find something").toBeGreaterThan(0);
    if (all.length === 0) return;
    if (typeof first === "string") expect(ids[0]).toBe(first);
    else expect(ids[0]).toMatch(first);
    for (const id of notFirst ?? []) expect(ids[0]).not.toBe(id);
    for (const id of top3 ?? []) expect(ids).toContain(id);
    if (family) for (const id of ids) expect(id).toMatch(family);
  });

  it("every synonym phrase names a command that exists (a renamed label cannot orphan the table)", () => {
    const labels = REAL.map((a) => `${a.label} ${a.keywords ?? ""}`.toLowerCase());
    for (const [key, phrases] of Object.entries(PALETTE_SYNONYMS)) {
      for (const phrase of phrases) {
        const words = phrase.split(" ");
        const hit = labels.some((l) => words.every((w) => new RegExp(`\\b${w}`).test(l)));
        expect(hit, `"${key}" -> "${phrase}" matches no command`).toBe(true);
      }
    }
  });
});

const cmd = (id: string, label: string, extra: Partial<Action> = {}): Action => ({ id, group: "Analyze", label, run: () => undefined, ...extra });

describe("rankActions rules", () => {
  it("a whole word beats a scattered subsequence (the original 'fit' bug)", () => {
    const list = [cmd("fft", "Film thickness (FFT)…"), cmd("cf", "Curve fit…")];
    expect(rankActions(list, "fit").map((r) => r.a.id)).toEqual(["cf", "fft"]);
  });

  it("a word match beats a prefix, a prefix beats a keyword, a keyword beats a description, a description beats fuzzy", () => {
    const list = [
      cmd("fuzzy", "Sum of both"), // s-m-o-o-t-h scattered
      cmd("desc", "Alpha", { description: "Applies a smoothing window." }),
      cmd("kw", "Beta", { keywords: "smooth" }),
      cmd("prefix", "Smoothing window"),
      cmd("word", "Smooth data"),
    ];
    const ids = rankActions(list, "smooth").map((r) => r.a.id);
    expect(ids).toEqual(["word", "prefix", "kw", "desc", "fuzzy"]);
  });

  it("fuzzy is the last resort, for terms of three letters or more", () => {
    const list = [cmd("a", "Hysteresis analysis…")];
    expect(rankActions(list, "hystxrsis")).toHaveLength(0); // not a subsequence: no match, not a wrong match
    expect(rankActions(list, "hyst")).toHaveLength(1); // prefix
    expect(rankActions(list, "hsts")).toHaveLength(1); // subsequence, last resort
    expect(rankActions(list, "h")).toHaveLength(1); // one letter: label word start only
    expect(rankActions([cmd("b", "Alpha", { description: "has h in it" })], "h")).toHaveLength(0);
  });

  it("every word of a multi-word query must match", () => {
    const list = [cmd("pdf", "Export PDF…"), cmd("csv", "Export CSV…"), cmd("fig", "Export figure…", { keywords: "pdf svg" })];
    expect(rankActions(list, "export pdf").map((r) => r.a.id)).toEqual(["pdf", "fig"]);
    expect(rankActions(list, "export zzz")).toEqual([]);
  });

  it("a synonym finds a command the typed word is not in, below a direct word match", () => {
    const list = [cmd("bl", "Baseline / background…"), cmd("m", "Magnetometry (background)")];
    expect(rankActions(list, "bg").map((r) => r.a.id)).toContain("bl"); // bg -> baseline
    const direct = rankActions([cmd("syn", "Curve fit…"), cmd("direct", "Fit Y by X")], "fit");
    expect(direct[0].a.id).toBe("syn"); // the canonical command wins the word it is named for
  });

  it("a plural stems to its word", () => {
    expect(rankActions([cmd("e", "Error bar styles")], "errors")).toHaveLength(1);
    expect(rankActions([cmd("p", "Peak Analyzer…")], "peaks")[0].score).toBeGreaterThan(80);
  });

  it("only s / es / ed make a stem: setup is not set, theme is not the", () => {
    expect(rankActions([cmd("s", "Set defaults")], "setup")).toHaveLength(0);
    expect(rankActions([cmd("t", "Toggle the grid", { description: "Show or hide the grid." })], "theme")).toHaveLength(0);
    expect(rankActions([cmd("f", "Peak")], "peaked")).toHaveLength(1);
    expect(rankActions([cmd("f", "Box")], "boxes")).toHaveLength(1);
  });

  it("a stem never outranks an exact word, with a first-word bonus or a heavy-use boost", () => {
    const list = [cmd("stem", "Peaks list"), cmd("exact", "Show peak")];
    const now = 1_000_000_000;
    // "peak": exact word in "Show peak" (100); "Peaks list" is a prefix/stem-less match (first word 90+2).
    expect(rankActions(list, "peak").map((r) => r.a.id)[0]).toBe("exact");
    const heavy = { stem: { n: 1e6, t: now } };
    expect(rankActions(list, "peak", heavy, now).map((r) => r.a.id)[0]).toBe("exact");
    // "peaks": the stem of "peak" in the FIRST word (95+2) against an exact later word (100).
    const list2 = [cmd("first", "Peak list"), cmd("exact", "Show peaks")];
    expect(rankActions(list2, "peaks", heavy, now).map((r) => r.a.id)[0]).toBe("exact");
  });

  it("description stopwords and short words do not match", () => {
    const a = cmd("a", "Alpha", { description: "Show the grid and an of it." });
    expect(rankActions([a], "the")).toHaveLength(0);
    expect(rankActions([a], "of")).toHaveLength(0);
    expect(rankActions([a], "grid")).toHaveLength(1);
  });

  it("filler words are optional in a multi-word query, required when alone", () => {
    const list = [cmd("s", "Smooth…")];
    expect(rankActions(list, "smooth data")).toHaveLength(1);
    expect(rankActions(list, "data")).toHaveLength(0);
    expect(rankActions(list, "the")).toHaveLength(0);
    // and matching filler still adds score
    const both = [cmd("a", "Import data…"), cmd("b", "Import files…")];
    expect(rankActions(both, "import data")[0].a.id).toBe("a");
  });

  it("a loose subsequence cannot satisfy one word of several", () => {
    const list = [cmd("split", "Split by column value…", { keywords: "separate" })];
    expect(rankActions(list, "set column values")).toHaveLength(0);
    expect(rankActions(list, "sep")).toHaveLength(1); // keyword prefix, alone
    expect(rankActions([cmd("x", "Hysteresis")], "hsts")).toHaveLength(1); // alone, fuzzy still works
  });

  it("a fuzzy match must open a word", () => {
    expect(rankActions([cmd("n", "Open new graph menu entry")], "theme")).toHaveLength(0);
  });

  it("usage reorders inside a tier but never lifts a weaker tier past a stronger one", () => {
    const list = [cmd("a", "Smooth alpha"), cmd("b", "Smooth beta"), cmd("p", "Smoothing gamma")];
    const now = 1_000_000_000;
    const heavy = { p: { n: 500, t: now }, b: { n: 3, t: now } };
    const ids = rankActions(list, "smooth", heavy, now).map((r) => r.a.id);
    expect(ids).toEqual(["b", "a", "p"]); // b beats a on use; the prefix match p stays last despite 500 runs
  });

  it("highlights the matched characters of the label", () => {
    const [r] = rankActions([cmd("d", "Derivative · dY/dX")], "deriv");
    expect(r.hits).toEqual([0, 1, 2, 3, 4]);
  });

  it("an empty query keeps every command in its given order", () => {
    const list = [cmd("x", "Zed"), cmd("y", "Alpha")];
    expect(rankActions(list, "  ").map((r) => r.a.id)).toEqual(["x", "y"]);
  });

  it("the synonym lookup reaches a half-typed key", () => {
    expect(synonymPhrases("deriv")).toContain("derivative");
    expect(synonymPhrases("de")).toEqual([]); // two letters are too loose to expand
  });
});
