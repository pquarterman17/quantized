// Acceptance 10 W3: a fixed legend corner (Legend popup > Position) sits INSIDE
// the plot frame, as the SVG export draws it (matplotlib's "upper left" etc. are
// inside the axes). Top left, Bottom left and Bottom right used to draw in the
// stage's corner, over the tick labels. jsdom lays nothing out, so this pins the
// rules in shell.css: every corner is anchored on the --qz-frame-* variables the
// plot publishes (lib/uplotFrameVars.ts), the way the auto legend is, and not on
// a bare 12px stage inset. The export side is `legendPosToLoc`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { legendPosToLoc } from "../../lib/figureOverrides";

const css = readFileSync(join(__dirname, "../../styles/shell.css"), "utf8").replace(/\r/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the last plain `.qzk-legend.<corner> { ... }` rule. */
function rule(corner: string): string {
  const head = `
.qzk-legend.${corner} {`;
  const at = css.lastIndexOf(head);
  expect(at, `a .qzk-legend.${corner} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at + head.length, css.indexOf("}", at));
}

/** The value of one declaration (`top`, `bottom`, ...) in a rule body. */
const decl = (body: string, prop: string): string =>
  body.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${prop}:`))?.slice(prop.length + 1) ?? "";

describe("a fixed legend corner is inside the plot frame", () => {
  it.each([
    ["ne", ["top", "right"]],
    ["nw", ["top", "left"]],
    ["se", ["bottom", "right"]],
    ["sw", ["bottom", "left"]],
  ] as const)("%s is anchored on the frame variables on both of its sides", (corner, sides) => {
    const body = rule(corner);
    for (const side of sides) {
      expect(decl(body, side), `${corner} ${side}`).toContain("--qz-frame-");
    }
  });

  it("the bottom corners use the frame's height, the right ones its width", () => {
    expect(decl(rule("se"), "bottom")).toContain("--qz-frame-height");
    expect(decl(rule("sw"), "bottom")).toContain("--qz-frame-height");
    expect(decl(rule("ne"), "right")).toContain("--qz-frame-width");
    expect(decl(rule("se"), "right")).toContain("--qz-frame-width");
    expect(decl(rule("nw"), "left")).toContain("--qz-frame-left");
  });

  it("the export puts the same corners inside the axes", () => {
    expect([legendPosToLoc("ne"), legendPosToLoc("nw"), legendPosToLoc("se"), legendPosToLoc("sw")]).toEqual([
      "upper right", "upper left", "lower right", "lower left",
    ]);
  });
});
