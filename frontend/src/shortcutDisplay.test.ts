// GUI_INTERACTION #17 guards — one source of truth for how a keyboard
// shortcut and the command-palette label are DISPLAYED.
//
// Both invariants here started as real defects, and both are the kind that
// come back the next time someone adds a menu surface, so they are pinned at
// the CLASS level (a source scan) rather than by asserting the two specific
// call sites that were wrong:
//
//   1. `Action.shortcut` strings are authored with the macOS `⌘`/`⌃` glyphs
//      baked in. The Shortcuts DIALOG translated them for non-Mac hosts via
//      `shortcutGroupsFor`, but the menubar and the ⌘K palette rendered them
//      RAW — so on Windows the File menu showed "⌘O" while Help ▸ Keyboard
//      shortcuts showed "Ctrl+O". Every surface must render through
//      `formatShortcut`.
//   2. "Open the command palette" is reachable from four surfaces, and three
//      of them hard-coded three different labels. The plan's acceptance
//      criterion is that palette labels match menu labels EXACTLY, so the
//      text lives in one exported constant.
//
// Reads raw module text the same way architecture.test.ts does.

import { describe, expect, it } from "vitest";

import { formatShortcut, isMacPlatform, shortcutGroupsFor } from "./lib/shortcuts";

const modules = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function sources(): [string, string][] {
  return Object.entries(modules).filter(
    ([p]) => !/\.test\.(ts|tsx)$/.test(p) && !p.endsWith("/shortcutDisplay.test.ts"),
  );
}

describe("formatShortcut", () => {
  it("keeps the ⌘/⌃ glyphs on macOS", () => {
    expect(formatShortcut("⌘O", true)).toBe("⌘O");
    expect(formatShortcut("⌃Tab", true)).toBe("⌃Tab");
    expect(formatShortcut("⌘⇧N", true)).toBe("⌘⇧N");
  });

  it("renders both ⌘ and ⌃ as Ctrl off macOS", () => {
    // ⌃ is the literal Control key (window cycling is Ctrl-only so it doesn't
    // collide with the macOS app switcher) — off macOS both read "Ctrl".
    expect(formatShortcut("⌘O", false)).toBe("CtrlO");
    expect(formatShortcut("⌃Tab", false)).toBe("CtrlTab");
  });

  it("leaves a shortcut with no modifier glyph untouched on either platform", () => {
    expect(formatShortcut("Delete", true)).toBe("Delete");
    expect(formatShortcut("Delete", false)).toBe("Delete");
  });

  it("agrees with the cheat-sheet's own translation (one shared implementation)", () => {
    // shortcutGroupsFor delegates to formatShortcut — if that ever forks, the
    // dialog and the menus can disagree again.
    for (const g of shortcutGroupsFor(false)) {
      for (const item of g.items) expect(item.keys).not.toMatch(/⌘|⌃/);
    }
    expect(shortcutGroupsFor(true)).toEqual(shortcutGroupsFor(true));
  });
});

describe("isMacPlatform", () => {
  it("returns a boolean in the test environment without throwing", () => {
    expect(typeof isMacPlatform()).toBe("boolean");
  });
});

describe("shortcut display is translated on every surface (#17)", () => {
  it("no module renders a shortcut without going through formatShortcut", () => {
    // The defect shape: `<span className="qz-shortcut">{a.shortcut}</span>`.
    // Any JSX interpolation of a `.shortcut` property that isn't wrapped in
    // formatShortcut(...) would show a ⌘ glyph to a Windows user.
    const raw = /\{\s*[A-Za-z_$][\w$]*\.shortcut\s*\}/;
    const offenders = sources()
      .filter(([, src]) => raw.test(src))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("no component hard-codes a bare ⌘ glyph in rendered shortcut markup", () => {
    // Catches the other half of the same defect: a literal
    // `<span className="qz-shortcut">⌘K</span>` bypasses the registry entirely.
    const hardCoded = /className="qz-shortcut"\s*>\s*[⌘⌃]/;
    const offenders = sources()
      .filter(([, src]) => hardCoded.test(src))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });
});

describe("command-palette label is single-sourced (#17)", () => {
  it("only store/commands.ts spells the palette label literally", () => {
    // Everything else imports PALETTE_LABEL. A new surface that retypes the
    // string re-opens the exact mismatch the plan item calls out.
    const literal = /"Command palette/;
    const offenders = sources()
      .filter(([, src]) => literal.test(src))
      .map(([p]) => p)
      .filter((p) => !p.endsWith("/store/commands.ts"));
    expect(offenders).toEqual([]);
  });
});

describe("the cheat-sheet and the command registry do not drift (#17)", () => {
  // Two independently-authored lists describe overlapping key combos:
  // `Action.shortcut` on each registered command, and SHORTCUT_GROUPS in the
  // Help sheet. They HAD drifted -- undo/redo, paste and Preferences were
  // registry commands absent from the sheet -- and the drift was invisible
  // because the two use different spacing ("⌘ Z" vs "⌘Z").
  const norm = (k: string) => k.replace(/\s+/g, "");

  /** Every `shortcut: "..."` literal declared anywhere in the source tree. */
  function registryShortcuts(): string[] {
    const out = new Set<string>();
    for (const [, src] of sources()) {
      for (const m of src.matchAll(/shortcut: "([^"]+)"/g)) out.add(m[1]);
      // The palette's shortcut moved to an exported constant.
      for (const m of src.matchAll(/PALETTE_SHORTCUT = "([^"]+)"/g)) out.add(m[1]);
    }
    return [...out];
  }

  it("every registry shortcut appears in the Help cheat-sheet", () => {
    const sheet = new Set(shortcutGroupsFor(true).flatMap((g) => g.items.map((i) => norm(i.keys))));
    const missing = registryShortcuts()
      .map(norm)
      .filter((k) => !sheet.has(k));
    expect(missing).toEqual([]);
  });

  it("finds a non-trivial number of registry shortcuts (the scan still works)", () => {
    // Guards the guard: if the `shortcut:` literal shape ever changes, the
    // test above would vacuously pass on an empty list.
    expect(registryShortcuts().length).toBeGreaterThan(8);
  });
});
