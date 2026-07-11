// Frontend architecture guards — the grep-able invariants that keep the row-state
// model (#50) the single source of truth for per-row selection/exclusion. Linking
// is threshold-shaped: 80%-linked feels broken, not innovative. Every view must
// read row state THROUGH the model so exclusion/selection is honored uniformly.
//
// Reads each source module's raw text at build time (Vite's import.meta.glob) and
// asserts the sanctioned modules are the only ones touching the persistent
// Dataset row-state fields. A new analysis view that needs the pruned rows must
// call lib/rowstate.analysisData — never re-derive exclusion itself.

import { describe, expect, it } from "vitest";

const modules = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every source module (path, text), minus tests and this guard file itself. */
function sources(): [string, string][] {
  return Object.entries(modules).filter(
    ([p]) => !/\.test\.(ts|tsx)$/.test(p) && !p.endsWith("/architecture.test.ts"),
  );
}

/** Modules that reference `re`, minus those whose path ends with an allowlisted
 *  suffix (the sanctioned model layers). */
function offenders(re: RegExp, allow: string[]): string[] {
  return sources()
    .filter(([, src]) => re.test(src))
    .map(([p]) => p)
    .filter((p) => !allow.some((a) => p.endsWith(a)));
}

// Component-ceiling ratchet (PROJECT_ORGANIZATION_PLAN #7 / PORT_PLAN W7).
// Convention: a .tsx component is <=400 lines; heavy features decompose via the
// workshop pattern (state hook + view + sub-components). This is a RATCHET, not
// a hard wall on day one: files that already exceed 400 get pinned at their
// CURRENT size so they can only SHRINK, never grow (identical spirit to the
// backend 500-line test and the MATLAB "never raise the ceiling" rule). A
// NEW .tsx over 400 fails. When a pinned file is extracted below 400, the
// honesty check tells you to delete its pin. Counting matches the guard below:
// src.split("\n").length.
const TSX_CEILING = 400;
// path-suffix -> grandfathered max (exact current line count). RATCHET DOWN ONLY.
// The pins have ratcheted to ZERO (MAIN_PLAN #1, 2026-07-11): App.tsx (954)
// decomposed into appCommands.ts / useGlobalShortcuts.ts / AppOverlays.tsx;
// ThinFilmTab.tsx (442) into thinfilm/ card sub-components; PlotStage.tsx's
// pin went earlier (MULTI_PLOT_PLAN #1, 2026-07-09 — PlotViewport.tsx /
// usePlotPayload.ts). Every .tsx now meets the 400 ceiling — keep it that way.
const GRANDFATHERED: Record<string, number> = {};

describe("component-ceiling ratchet (#7)", () => {
  const tsx = sources().filter(([p]) => p.endsWith(".tsx"));

  it("no .tsx component exceeds its ceiling (400, or its grandfathered pin)", () => {
    const over: string[] = [];
    for (const [p, src] of tsx) {
      const lines = src.split("\n").length;
      const pinKey = Object.keys(GRANDFATHERED).find((k) => p.endsWith(k));
      const ceiling = pinKey ? GRANDFATHERED[pinKey] : TSX_CEILING;
      if (lines > ceiling) over.push(`${p}: ${lines} > ${ceiling}`);
    }
    expect(
      over,
      "decompose via the workshop pattern (hook + view + sub-components); do NOT raise the ceiling",
    ).toEqual([]);
  });

  it("grandfathered pins stay honest — a file that dropped under 400 must lose its pin", () => {
    const stale: string[] = [];
    for (const key of Object.keys(GRANDFATHERED)) {
      const entry = tsx.find(([p]) => p.endsWith(key));
      if (!entry) {
        stale.push(`${key}: no longer exists — remove its pin`);
        continue;
      }
      if (entry[1].split("\n").length <= TSX_CEILING) {
        stale.push(`${key}: now <=${TSX_CEILING} — remove its pin (ratchet down)`);
      }
    }
    expect(stale, "the grandfathered list must shrink as files are extracted").toEqual([]);
  });
});

// Store-size ratchet (MAIN_PLAN #2). store/useApp.ts is the composed app
// store; the MDI window slice was extracted to store/windows.ts (2026-07-11),
// dropping useApp.ts to the pin below. Same iron rule as the component
// ceilings: the pin only RATCHETS DOWN — when the store grows, extract the
// next cohesive slice (windows.ts is the template), never raise the number.
const STORE_PINS: Record<string, number> = {
  "/store/useApp.ts": 3287, // post-#2 split, recalibrated at the Wave-A merge (anchor bridge + figure-page flag + GB seed landed in parallel); next candidates: corrections/importing slices
  // Review finding 2026-07-11: code that left App.tsx's component ratchet
  // must not become unguarded — the extracted registry + window slice get
  // their own shrink-only pins (founded at their extraction size).
  "/appCommands.ts": 684,
  "/store/windows.ts": 751,
};

describe("store-size ratchet (MAIN_PLAN #2)", () => {
  it("pinned store modules only shrink — extract a slice, never raise the pin", () => {
    const over: string[] = [];
    for (const [key, ceiling] of Object.entries(STORE_PINS)) {
      const entry = sources().find(([p]) => p.endsWith(key));
      if (!entry) {
        over.push(`${key}: missing — update or remove its pin`);
        continue;
      }
      const lines = entry[1].split("\n").length;
      if (lines > ceiling) over.push(`${key}: ${lines} > ${ceiling}`);
    }
    expect(
      over,
      "extract another slice (see store/windows.ts for the pattern); do NOT raise the pin",
    ).toEqual([]);
  });
});

describe("row-state model guard (#50 universal linking)", () => {
  it("only the row-state model reads/writes Dataset.excludedRows", () => {
    // rowstate = the exclusion primitives; workspace = .dwk (de)serialize;
    // useApp = the store mutation actions. Everything else goes through
    // rowstate.analysisData / droppedRows / excludedSet.
    const allow = ["/lib/rowstate.ts", "/lib/workspace.ts", "/store/useApp.ts"];
    expect(
      offenders(/\.excludedRows\b/, allow),
      "read exclusion via lib/rowstate (analysisData/droppedRows/excludedSet), not Dataset.excludedRows directly",
    ).toEqual([]);
  });

  it("only sanctioned modules reduce the local filter via filteredOutRows", () => {
    // datafilter defines it; rowstate is the chokepoint that folds it into
    // analysisData; the filter workshop uses it for its live drop-count preview.
    const allow = [
      "/lib/datafilter.ts",
      "/lib/rowstate.ts",
      "/components/workshops/datafilter/useDataFilter.ts",
    ];
    expect(
      offenders(/\bfilteredOutRows\s*\(/, allow),
      "derive dropped rows via lib/rowstate.analysisData, not filteredOutRows",
    ).toEqual([]);
  });
});
