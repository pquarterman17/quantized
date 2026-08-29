// Locks in a behavioural claim `errorLabelClassify.ts` makes only in prose:
// that a bare "Depth"/"Density"/"Delay" is "all zero-candidate, so unaffected
// either way". That sentence is load-bearing -- it is the reason an ordinary
// measurement column whose name merely STARTS with an error-token-like prefix
// (d- for delta, s- for sigma/std, e- for err) is not silently eaten as an
// error bar -- and until now nothing tested it.
//
// The classifier rewrite (#238) is what made these zero-candidate; this file
// exists so a future token addition or ranking tweak cannot quietly undo it.
// Checked at all three layers, because they have independently different
// fallback rules: the context-free wrapper deliberately returns the top-ranked
// candidate REGARDLESS of confidence (so it is the laxest and the most likely
// to regress), `classifyErrorLabelInLabels` is evidence-gated, and
// `inferErrorBindingsFromLabels` is what the user actually feels.

import { describe, expect, it } from "vitest";

import { classifyErrorLabel, classifyErrorLabelInLabels } from "./errorLabelClassify";
import { inferErrorBindingsFromLabels } from "./errorRoles";

// Ordinary column names from real lab data that begin with a prefix the token
// table cares about. None is an error bar.
const ORDINARY = [
  "Depth",
  "Density",
  "Delay",
  "Deviation",
  "Delta",
  "Deg",
  "Sample",
  "Sensitivity",
  "Separation",
  "Temperature",
  "Energy",
  "Extinction",
];

describe("ordinary names that merely start with an error-token prefix", () => {
  it("are not error-like context-free (the laxest layer)", () => {
    for (const name of ORDINARY) {
      expect(classifyErrorLabel(name), name).toBeNull();
    }
  });

  it("are not error-like among siblings", () => {
    for (const name of ORDINARY) {
      const labels = ["T", "R", name];
      expect(classifyErrorLabelInLabels(labels, 2), name).toBeNull();
    }
  });

  it("survive a same-initial sibling that could look like their base", () => {
    // The nastiest shape: a real "D" column sitting next to "Depth". If
    // "Depth" ever generated a d-prefix candidate, "D" is exactly the sibling
    // evidence that would confirm it and bind Depth as D's error bar.
    expect(classifyErrorLabelInLabels(["D", "Depth"], 1)).toBeNull();
    expect(classifyErrorLabelInLabels(["S", "Sample"], 1)).toBeNull();
    expect(classifyErrorLabelInLabels(["E", "Energy"], 1)).toBeNull();
  });

  it("bind no error roles end-to-end", () => {
    for (const name of ORDINARY) {
      expect(inferErrorBindingsFromLabels(["T", "R", name]), name).toEqual([]);
    }
    // And the same-initial pairing shape, end to end.
    expect(inferErrorBindingsFromLabels(["D", "Depth"])).toEqual([]);
  });

  it("still detects a genuine error bar alongside them (not merely inert)", () => {
    // Guards the obvious way to make every assertion above pass for the wrong
    // reason: a classifier that returns null for everything.
    expect(inferErrorBindingsFromLabels(["Depth", "R", "Rerr"]).length).toBeGreaterThan(0);
    expect(classifyErrorLabel("Rerr")).not.toBeNull();
  });
});
