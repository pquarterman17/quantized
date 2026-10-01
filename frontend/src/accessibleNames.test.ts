// Accessible-name ratchet, static half (PRIMARY_SOFTWARE_AUDIT_PLAN —
// "Accessible names/state for icons, plots, trees, dialogs, progress", U6).
//
// An icon-only control is announced by its CONTENT before its `title`, so a
// glyph button with only a tooltip is read as "▤" — or as nothing. Every such
// control in the app carries a short `aria-label`; this guard keeps it that
// way. The scanner itself lives in `test/accessibleNameScan.ts`, and the
// render-level half (real names, via dom-accessibility-api) in
// `accessibleNames.render.test.tsx`.
//
// components/Library was pinned (23, then 21) until its own pass (V1) named
// the rest, so the requirement is now zero app-wide with no exception.

import { describe, expect, it } from "vitest";

import { childText, findUnnamedControls, isWordLikeName } from "./test/accessibleNameScan";

const modules = import.meta.glob("./**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function scan(): string[] {
  const hits: string[] = [];
  for (const [p, src] of Object.entries(modules)) {
    if (/\.test\.tsx$/.test(p)) continue;
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

describe("accessible-name ratchet (U6, Library V1)", () => {
  it("no icon-only control anywhere in the app is named by a glyph or by nothing", () => {
    expect(
      scan(),
      'add a short aria-label (one or two words, matching the title) — e.g. <button aria-label="Library" title="Toggle library">▤</button>',
    ).toEqual([]);
  });
});
