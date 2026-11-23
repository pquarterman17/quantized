// Realdata half of windowLayoutRestore.test.ts (WORKSPACE_LAYOUT_PLAN P6
// acceptance: opening each realdata fixture project restores the exact
// placements). Driven by tools/layout_corpus_run.py, which converts every
// Origin project of the private corpus (`<root>/test-data/origin`, never copied
// into the repo) to `.dwk` in a scratch directory with `qz convert --to dwk`
// and points QZ_LAYOUT_CORPUS_DIR at it. Skipped without that variable, so CI
// and a checkout without the corpus skip it. Expectations are computed at run
// time; nothing from the corpus is written into the repo.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkLayoutRestore } from "../test/layoutRestoreCheck";
import { useApp } from "./useApp";

const DIR = process.env.QZ_LAYOUT_CORPUS_DIR;

afterEach(() => localStorage.clear());

describe.skipIf(!DIR)("realdata: every converted corpus project restores its layout exactly", () => {
  it("each project: the template lays it out, its saved layout wins and comes back exactly", { timeout: 1_800_000 }, async () => {
    const files = readdirSync(DIR as string).filter((f) => f.endsWith(".dwk")).sort();
    // The driver says how many it converted, so a run that silently read fewer fails.
    expect(files.length).toBe(Number(process.env.QZ_LAYOUT_CORPUS_COUNT ?? files.length));
    expect(files.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const f of files) {
      localStorage.clear();
      useApp.setState({ windowLayout: null, layoutMode: "classic", history: [], future: [] });
      try {
        await checkLayoutRestore(readFileSync(join(DIR as string, f), "utf8"), f);
      } catch (err) {
        failures.push(`${f}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    }
    // Every failure is named (by its scratch file name, never a corpus path).
    expect(failures).toEqual([]);
  });
});
