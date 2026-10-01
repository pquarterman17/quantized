// Accessible-name ratchet, static half (PRIMARY_SOFTWARE_AUDIT_PLAN —
// "Accessible names/state for icons, plots, trees, dialogs, progress", U6).
//
// An icon-only control is announced by its CONTENT before its `title`, so a
// glyph button with only a tooltip is read as "▤" — or as nothing. Every such
// control outside components/Library now carries a short `aria-label`; this
// guard keeps it that way. The scanner itself lives in
// `test/accessibleNameScan.ts`, and the render-level half (real names, via
// dom-accessibility-api) in `accessibleNames.render.test.tsx`.
//
// components/Library is owned by a separate pass, so its count is PINNED at
// today's value, not zero — same iron law as every other ratchet: the pin may
// only go down, and a pin that is no longer met exactly must be lowered.

import { describe, expect, it } from "vitest";

import { childText, findUnnamedControls, isWordLikeName } from "./test/accessibleNameScan";

const modules = import.meta.glob("./**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const LIBRARY_DIR = "./components/Library/";
/** components/Library's unnamed icon controls on 2026-10-01. Ratchet DOWN only. */
const LIBRARY_UNNAMED_PIN = 23;

function scan(inLibrary: boolean): string[] {
  const hits: string[] = [];
  for (const [p, src] of Object.entries(modules)) {
    if (/\.test\.tsx$/.test(p) || p.startsWith(LIBRARY_DIR) !== inLibrary) continue;
    for (const h of findUnnamedControls(src)) hits.push(`${p}:${h.line} <${h.tag}> ${h.reason}`);
  }
  return hits.sort();
}

describe("accessible-name scanner (positive and negative controls)", () => {
  const hits = (jsx: string) => findUnnamedControls(jsx).map((h) => h.reason);

  it("flags a glyph button that only has a title — its name is the glyph", () => {
    expect(hits(`<button className="qz-icon-btn" title="Toggle library">▤</button>`)).toHaveLength(1);
    expect(hits(`<button title="Remove">×</button>`)).toHaveLength(1);
    expect(hits(`<IconButton title="Delete" onClick={f}>✕</IconButton>`)).toHaveLength(1);
    expect(hits(`<button title="Theme">{dark ? "☾" : "☀"}</button>`)).toHaveLength(1);
    expect(hits(`<button className="qz-icon-btn" title="Insert">{e.glyph}</button>`)).toHaveLength(1);
    expect(hits(`<button>q</button>`)).toHaveLength(1);
    expect(hits(`<button onClick={f} />`)).toHaveLength(1);
  });

  it("passes labelled, worded, and statically unknowable controls", () => {
    expect(hits(`<button className="qz-icon-btn" aria-label="Library" title="Toggle library">▤</button>`)).toEqual([]);
    expect(hits(`<IconButton aria-labelledby="x">✕</IconButton>`)).toEqual([]);
    expect(hits(`<button title="Grey"><span aria-hidden="true">◉</span> Grey excluded rows</button>`)).toEqual([]);
    expect(hits(`<button>{open ? "▾" : "▸"} Start values</button>`)).toEqual([]);
    expect(hits(`<button title="Pick">{name}</button>`)).toEqual([]);
    expect(hits(`<button {...props}>×</button>`)).toEqual([]);
    expect(hits(`<button title="Settings" onClick={f} />`)).toEqual([]);
    expect(hits(`<label className="qz-icon-btn">⤒<input type="file" aria-label="Load image" /></label>`)).toEqual([]);
    // Comments are not markup.
    expect(hits(`// a <button>×</button> in prose\n{/* <button>×</button> */}`)).toEqual([]);
  });

  it("does not mistake a `/*` inside a string for a comment that hides later markup", () => {
    expect(hits(`<input accept="image/*" />\n<button title="Close">×</button>`)).toHaveLength(1);
  });

  it("reads aria-hidden subtrees out of the name and keeps their siblings", () => {
    expect(childText(`<span aria-hidden="true">⧉</span> Copy`).text.trim()).toBe("Copy");
    expect(childText(`<span aria-hidden={false}>Copy</span>`).text).toBe("Copy");
    expect(isWordLikeName("Σx")).toBe(true);
    expect(isWordLikeName("▤")).toBe(false);
    expect(isWordLikeName("Q")).toBe(false);
  });
});

describe("accessible-name ratchet (U6)", () => {
  it("no icon-only control outside components/Library is named by a glyph or by nothing", () => {
    expect(
      scan(false),
      'add a short aria-label (one or two words, matching the title) — e.g. <button aria-label="Library" title="Toggle library">▤</button>',
    ).toEqual([]);
  });

  it(`components/Library stays at or under its pin (${LIBRARY_UNNAMED_PIN})`, () => {
    const hits = scan(true);
    expect(hits.length, `new unnamed Library controls:\n${hits.join("\n")}`).toBeLessThanOrEqual(
      LIBRARY_UNNAMED_PIN,
    );
  });

  it("the Library pin stays honest — fixed sites lower it (ratchet down)", () => {
    expect(scan(true).length, "lower LIBRARY_UNNAMED_PIN to the current count").toBe(LIBRARY_UNNAMED_PIN);
  });
});
