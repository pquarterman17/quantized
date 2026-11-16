// The ⌘K ranker. Two layers: a BENCHMARK table of real things a scientist
// types, run against the REAL command registry (so a rewritten label or a
// dropped keyword fails here, not in front of a user); and focused unit tests
// of each ranking rule on synthetic commands.
import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import type { Action } from "../store/commands";
import { useApp } from "../store/useApp";
import { rankActions } from "./paletteRank";
import { PALETTE_SYNONYMS, synonymPhrases } from "./paletteSynonyms";

const REAL = buildAppActions(useApp.getState);

interface Row {
  q: string;
  /** The id at rank 1, or a pattern for a family whose members tie. */
  first: string | RegExp;
  /** Ids that must ALL appear in the top three. */
  top3?: string[];
  /** Every one of the top three must match (a family query). */
  family?: RegExp;
}

// The three failures that started this (2026-11): "fit" ranked Film thickness
// (FFT) first, "export pdf" found nothing, "error bar" returned Ternary diagram.
const BENCHMARK: Row[] = [
  { q: "fit", first: "curvefit", top3: ["curvefit", "fit-y-by-x", "panel-fit"] },
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
  { q: "subtract background", first: "baseline", top3: ["baseline", "magtools"] },
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
];

describe("palette ranking benchmark (real commands)", () => {
  it.each(BENCHMARK)("$q", ({ q, first, top3, family }) => {
    const ids = rankActions(REAL, q).slice(0, 3).map((r) => r.a.id);
    if (typeof first === "string") expect(ids[0]).toBe(first);
    else expect(ids[0]).toMatch(first);
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
