// UX-004. The Library's node-type marks COLLIDED — ▦ meant Folder, Figure
// page, Worksheet and two different commands at once; ▤ meant Workbook and
// Report; ▥ meant Worksheet in the tree and five artifact kinds in
// Collections — and nothing checked, because the earlier UX-001 icon audit
// (`rowIconAccessibility.test.tsx`) only asserted that each mark was
// LABELLED, never that two marks were DISTINGUISHABLE from each other. That
// gap is exactly why the defect shipped. This file closes it.
//
// The load-bearing assertion is injectivity: over the COMPLETE node-kind set,
// no two kinds may share a mark. Everything else here defends that claim's
// preconditions — that the map is complete, that the vocabulary the map
// declares is the vocabulary the components actually render, and that a type
// mark never collides with a command or status mark on the same row.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FROZEN_MARK,
  LIBRARY_NODE_GLYPH,
  LIBRARY_NODE_KINDS,
  LIBRARY_NODE_LABEL,
} from "./nodeIcons";
import type { LibraryNodeKind } from "../../lib/libraryHierarchy";

/** A sibling component's source. `__dirname` is the established way tests
 *  here reach the file on disk (styles/reducedMotion.test.ts) — `import.meta.url`
 *  is not a `file:` URL under this vitest config. */
const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

/** The COMPLETE list of kinds, written out by hand so the test fails if
 *  `LibraryNodeKind` gains a member and this file is not revisited. The
 *  `satisfies` keeps it honest in the other direction (a name that is not a
 *  real kind will not compile). */
const ALL_KINDS = [
  "folder",
  "workbook",
  "worksheet",
  "origin-figure",
  "editable-figure",
  "publication-figure",
  "page",
  "report",
] as const satisfies readonly LibraryNodeKind[];

/**
 * Every NON-type glyph a Library row can paint, with what it means and the
 * file that renders it — the other half of the inventory the type map does
 * not cover. Kept here rather than in the shipped module so it costs the
 * eager bundle nothing; the `appears in its source file` case below is what
 * stops it rotting.
 *
 * `refersToKind` marks the two commands that deliberately wear a node kind's
 * OWN mark because the command names that kind ("New folder", "open the
 * source workbook"). Those are re-use, not collision, and are the only
 * glyphs exempted from the disjointness check.
 */
const ROW_COMMAND_GLYPHS: ReadonlyArray<{
  glyph: string;
  means: string;
  file: string;
  refersToKind?: LibraryNodeKind;
}> = [
  { glyph: "⠿", means: "drag handle (resting cue)", file: "DatasetRowParts.tsx" },
  { glyph: "⋯", means: "more actions (resting cue)", file: "DatasetRowParts.tsx" },
  { glyph: "▸", means: "collapsed disclosure caret", file: "FolderRow.tsx" },
  { glyph: "▾", means: "expanded disclosure caret", file: "FolderRow.tsx" },
  { glyph: "●", means: "stale — data changed, click to recalculate", file: "DatasetRowParts.tsx" },
  { glyph: "↻", means: "recomputed from a saved fit", file: "RecomputedMark.tsx" },
  { glyph: "⇢", means: "derived from another worksheet", file: "DerivedWorksheetMark.tsx" },
  { glyph: "∿", means: "show/hide the inline preview (resting cue)", file: "DatasetRowPreview.tsx" },
  { glyph: "⊞", means: "open in a new graph window", file: "FigureRow.tsx" },
  { glyph: "▣", means: "open the saved Origin preview", file: "FigureRow.tsx" },
  { glyph: "▲", means: "move up (flat card only)", file: "DatasetRow.tsx" },
  { glyph: "▼", means: "move down (flat card only)", file: "DatasetRow.tsx" },
  { glyph: FROZEN_MARK, means: "frozen data (status, not type)", file: "ArtifactRows.tsx" },
  {
    glyph: "▤",
    means: "open the source workbook",
    file: "FigureRow.tsx",
    refersToKind: "workbook",
  },
  { glyph: "▰", means: "New folder (toolbar)", file: "Library.tsx", refersToKind: "folder" },
];

describe("UX-004 — the Library node-type vocabulary is INJECTIVE", () => {
  it("no two node kinds share a glyph, over the complete kind set", () => {
    const seen = new Map<string, LibraryNodeKind>();
    const collisions: string[] = [];
    for (const kind of ALL_KINDS) {
      const glyph = LIBRARY_NODE_GLYPH[kind];
      const previous = seen.get(glyph);
      if (previous) collisions.push(`"${glyph}" is both ${previous} and ${kind}`);
      else seen.set(glyph, kind);
    }
    expect(collisions).toEqual([]);
    expect(seen.size).toBe(ALL_KINDS.length);
  });

  it("no two node kinds share a label either", () => {
    const labels = ALL_KINDS.map((kind) => LIBRARY_NODE_LABEL[kind]);
    expect(new Set(labels).size).toBe(ALL_KINDS.length);
  });

  it("the map is COMPLETE and the kind list has not drifted", () => {
    expect([...LIBRARY_NODE_KINDS].sort()).toEqual([...ALL_KINDS].sort());
    expect(Object.keys(LIBRARY_NODE_GLYPH).sort()).toEqual([...ALL_KINDS].sort());
    expect(Object.keys(LIBRARY_NODE_LABEL).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("every kind's glyph is exactly one non-blank character, and every kind is named", () => {
    for (const kind of ALL_KINDS) {
      expect([...LIBRARY_NODE_GLYPH[kind]]).toHaveLength(1);
      expect(LIBRARY_NODE_GLYPH[kind].trim()).not.toBe("");
      expect(LIBRARY_NODE_LABEL[kind].length).toBeGreaterThan(2);
    }
  });

  it("no glyph is an emoji-presentation character (CLAUDE.md: Unicode glyphs, never emoji)", () => {
    // U+FE0F is the emoji variation selector; the astral emoji blocks start at
    // U+1F300. A one-codepoint BMP glyph below that range renders as text.
    for (const kind of ALL_KINDS) {
      const code = LIBRARY_NODE_GLYPH[kind].codePointAt(0) ?? 0;
      expect(code).toBeLessThan(0x1f300);
      expect(LIBRARY_NODE_GLYPH[kind]).not.toContain("️");
    }
  });
});

describe("UX-004 — a type mark never collides with a command or status mark", () => {
  it("the command/status glyphs are themselves distinct", () => {
    const glyphs = ROW_COMMAND_GLYPHS.filter((g) => !g.refersToKind).map((g) => g.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("no command/status glyph reuses a node-type mark, unless it NAMES that kind", () => {
    const typeMarks = new Map(ALL_KINDS.map((kind) => [LIBRARY_NODE_GLYPH[kind], kind] as const));
    const offenders = ROW_COMMAND_GLYPHS.filter((entry) => {
      const kind = typeMarks.get(entry.glyph);
      if (!kind) return false;
      return entry.refersToKind !== kind;
    }).map((entry) => `"${entry.glyph}" (${entry.means}, ${entry.file}) collides with a node type`);
    expect(offenders).toEqual([]);
  });

  it("a command that claims to name a kind really wears that kind's mark", () => {
    for (const entry of ROW_COMMAND_GLYPHS) {
      if (!entry.refersToKind) continue;
      expect(entry.glyph).toBe(LIBRARY_NODE_GLYPH[entry.refersToKind]);
    }
  });
});

describe("UX-004 — the declared vocabulary is the one the components render", () => {
  it("each command/status glyph still appears in the file this table names", () => {
    const missing = ROW_COMMAND_GLYPHS.filter((entry) => {
      // A kind-naming command renders the shared constant, not a literal — so
      // for those, check the constant reference instead of the character.
      const needle = entry.refersToKind
        ? `LIBRARY_NODE_GLYPH.${entry.refersToKind}`
        : entry.glyph;
      return !read(entry.file).includes(needle);
    }).map((entry) => `${entry.glyph} (${entry.means}) is no longer in ${entry.file}`);
    expect(missing).toEqual([]);
  });

  it("no Library component declares a node-type glyph of its own any more", () => {
    // The three rival maps this module replaced were spotted only by reading
    // eight files. `nodeIcons.ts` is now the single source of truth, so no
    // OTHER file in this directory may hold a kind-keyed glyph table.
    const rivals = [
      "CollectionsSection.tsx",
      "TilePreview.tsx",
      "DetailsRow.tsx",
      "ArtifactRows.tsx",
    ].filter((file) => /KIND_GLYPH\s*(:|=)/.test(read(file)));
    expect(rivals).toEqual([]);
  });

  it("the retired colliding marks are gone from every Library component", () => {
    // ▦/▥ were the two marks that meant several different things at once.
    // Neither is in the vocabulary any more, so neither may appear as a
    // rendered literal in this directory's components. (This file and
    // `nodeIcons.ts` both name them in prose, and are excluded.)
    const files = [
      "ArtifactRows.tsx",
      "CollectionsSection.tsx",
      "DatasetRow.tsx",
      "DetailsRow.tsx",
      "EditableFiguresSection.tsx",
      "FigureRow.tsx",
      "FolderRow.tsx",
      "Library.tsx",
      "PagesSection.tsx",
      "ReportsSection.tsx",
      "SavedFiguresSection.tsx",
      "TilePreview.tsx",
      "WorkbookRow.tsx",
    ];
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of read(file).split("\n")) {
        // Skip comment lines — the retired marks are named there on purpose,
        // as the record of what each site used to draw.
        const code = line.trimStart();
        // `//`, `/* … */`, a continuation `* …`, and JSX's `{/* … */}`.
        if (/^(\/\/|\/\*|\*|\{\/\*)/.test(code)) continue;
        if (code.includes("▦") || code.includes("▥")) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
