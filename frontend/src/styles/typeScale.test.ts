// Help / meta / label typography contract (UX audit 7, lane G1), asserted on the
// shared classes in shell.css so a per-component override cannot quietly bring
// the problems back:
//   - `.qzk-ds-meta` (576 uses) rendered help text as 9 px faint MONO on ONE
//     line with an ellipsis, so the first-launch onboarding sentence was cut off.
//   - `.qzk-field-lbl` (355 uses) was 10 px UPPERCASE faint text.
// Prose is UI sans, wraps, and uses AA text colour; data meta stays mono and
// single-line; labels are sentence case. Reads the stylesheet as text (the
// established pattern here), through the shared flatRules parser.

import { describe, expect, it } from "vitest";

import { flatRules, readShellCss } from "./cssRules.testkit";

const rules = flatRules(readShellCss());
const body = (selector: string): string => {
  const hit = rules.find((r) => r.selector.split(",").map((x) => x.trim()).includes(selector));
  if (!hit) throw new Error(`no rule for ${selector}`);
  return hit.body;
};

describe("help / meta prose", () => {
  for (const sel of [".qzk-ds-meta", ".qzk-helptext"]) {
    it(`${sel}: UI font, readable size, AA colour, wraps (never truncates)`, () => {
      const b = body(sel);
      expect(b).toContain("font-family: var(--font-ui)");
      expect(b).toContain("font-size: var(--font-size-help)");
      expect(b).toContain("color: var(--text-dim)");
      expect(b).not.toMatch(/white-space:\s*nowrap/);
      expect(b).not.toContain("text-overflow");
      expect(b).not.toMatch(/overflow:\s*hidden/);
      expect(b).not.toContain("--type-nano");
      expect(b).not.toContain("--text-faint");
    });
  }

  it("the prose class does not collide with another stylesheet's rule (the Help dialog owns .qzk-help, 680px wide)", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const f of ["shell.css", "components.css", "platform.css"]) {
      const sels = flatRules(readFileSync(join(dir, f), "utf8")).flatMap((r) => r.selector.split(",").map((x) => x.trim()));
      const n = sels.filter((x) => x === ".qzk-helptext" || x === ".qzk-meta").length;
      expect(n, f).toBe(f === "shell.css" ? 2 : 0);
    }
  });

  it(".qzk-meta is the data variant: mono, one line, may ellipsize, still AA", () => {
    const b = body(".qzk-meta");
    expect(b).toContain("font-family: var(--font-mono)");
    expect(b).toMatch(/white-space:\s*nowrap/);
    expect(b).toContain("color: var(--text-dim)");
    expect(b).toContain("font-size: var(--font-size-sm)");
  });

  it("the help size is a real step above the small control size in every density", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "spacing.css"), "utf8");
    for (const d of ["regular", "compact", "comfy"]) {
      const blk = css.slice(css.indexOf(`[data-density="${d}"]`));
      const sm = Number(/--font-size-sm:\s*(\d+)px/.exec(blk)?.[1]);
      const help = Number(/--font-size-help:\s*(\d+)px/.exec(blk)?.[1]);
      expect(help, d).toBe(sm + 1);
      expect(help, d).toBeGreaterThanOrEqual(11);
    }
  });
});

describe("form labels", () => {
  it(".qzk-field-lbl is sentence case, readable, AA", () => {
    const b = body(".qzk-field-lbl");
    expect(b).not.toContain("text-transform");
    expect(b).not.toContain("letter-spacing");
    expect(b).not.toMatch(/font-size:\s*\d+px/);
    expect(b).toContain("font-size: var(--font-size-sm)");
    expect(b).toContain("color: var(--text-dim)");
  });

  it("the inline field label (.qzk-field > span) follows the same rule", () => {
    const b = body(".qzk-field > span");
    expect(b).not.toContain("text-transform");
    expect(b).toContain("color: var(--text-dim)");
  });

  it("UPPERCASE is still used for menu section labels (the one intentional exception)", () => {
    expect(body(".qzk-menu-label")).toContain("text-transform: uppercase");
  });
});
