// Guard: a code path that removes, inserts or moves a worksheet COLUMN must
// carry every reference held OUTSIDE that dataset across the shift — plot
// windows, saved figures, Graph Builder specs, the live view and, since the
// worksheet-ops audit, other worksheets' `sheet("Name", L)` formulas
// (lib/sheetRefs.ts). One function does all of that:
// store/columnRemovalRefs.ts's `columnRemovalRefsPatch`. A path that shifted
// the dataset's own channels and skipped it would leave a reader's letter
// pointing at whatever column slid into place — the silent re-point the audit
// found.
//
// The signal for "this code shifts a dataset's columns" is a call to
// `remapDatasetChannels` (the dataset's OWN channel-indexed fields) or
// `remapSurvivingFormulas` (its formulas). Every module making either call
// must call `columnRemovalRefsPatch` itself, or be listed in DELEGATES with
// the module that does — and that module must really call it and import the
// delegate's chain. A future column delete / move feature therefore cannot
// land without the patch: this test names the file that skipped it.

import { describe, expect, it } from "vitest";

const modules = import.meta.glob("./**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sources = Object.entries(modules).filter(([p]) => !/\.test\.(ts|tsx)$/.test(p));
const src = (path: string): string => modules[path] ?? "";

const SHIFTS = /\b(?:remapDatasetChannels|remapSurvivingFormulas)\(/;
const PATCHES = /\bcolumnRemovalRefsPatch\(/;

/** A shifting module that does not patch itself → [its caller chain, ending
 *  in the module that calls `columnRemovalRefsPatch`]. Each link must import
 *  the previous one. */
const DELEGATES: Record<string, string[]> = {
  // The derived-sheet recalc: its own-field shift is applied inside the pass
  // whose caller patches the outside references.
  "./store/derivedSheetShift.ts": [
    "./store/derivedWorksheetsRecompute.ts",
    "./store/derivedWorksheets.ts", // a lazy import("./derivedWorksheetsRecompute")
    "./store/recalcDatasets.ts",
  ],
};

describe("column shifts carry outside references (columnRemovalRefsPatch)", () => {
  it("every module that shifts a dataset's columns calls the patch, or delegates to one that does", () => {
    const shifting = sources.filter(([p, s]) => SHIFTS.test(s) && !p.startsWith("./lib/")).map(([p]) => p);
    expect(shifting.length).toBeGreaterThan(0); // the scan itself still finds the known paths
    const unpatched = shifting.filter((p) => !PATCHES.test(src(p)) && !(p in DELEGATES));
    expect(unpatched, "call columnRemovalRefsPatch (store/columnRemovalRefs.ts) on this column shift").toEqual([]);
  });

  it("each delegate chain is real: every link imports the previous one, and the last patches", () => {
    for (const [from, chain] of Object.entries(DELEGATES)) {
      expect(SHIFTS.test(src(from)), `${from} no longer shifts columns — drop it from DELEGATES`).toBe(true);
      let prev = from;
      for (const link of chain) {
        const stem = prev.replace(/^\.\/store\//, "./").replace(/\.tsx?$/, "");
        expect(src(link), `${link} must import ${prev}`).toContain(`"${stem}"`);
        prev = link;
      }
      expect(PATCHES.test(src(prev)), `${prev} must call columnRemovalRefsPatch`).toBe(true);
    }
  });
});
