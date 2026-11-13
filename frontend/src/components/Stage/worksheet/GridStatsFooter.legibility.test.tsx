// Live check (worksheet ops): with the audit's five extra statistics the
// footer is 11 rows, sticky over the last rows of the sheet. Its cells had no
// background, so the rows underneath printed through them, and the stat names
// were cut to "Me…", "Va…", "SE me…" by the 44 px row-number gutter.
// jsdom cannot parse all of shell.css, so this reads the footer's own rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import GridStatsFooter, { STAT_ROWS } from "./GridStatsFooter";
import { DEFAULT_GUTTER_WIDTH } from "../../../lib/gridwindow";

const shellCss = readFileSync(join(__dirname, "../../../styles/shell.css"), "utf8");

/** shell.css's footer rules as [selector, declarations]. jsdom resolves no
 *  var() tokens in computed styles, so the rules are matched directly. */
const footerRules: [string, string][] = shellCss
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("}")
  .map((rule) => rule.split("{"))
  .filter((parts): parts is [string, string] => parts.length === 2 && /qzk-grid-footer/.test(parts[0]) && !parts[0].includes("@"))
  .map(([sel, body]) => [sel.trim(), body]);

/** The background a footer rule paints on `el`, or null when none matches. */
function footerBackground(el: Element): string | null {
  let bg: string | null = null;
  for (const [sel, body] of footerRules) {
    const m = /background(?:-color)?\s*:\s*([^;]+)/.exec(body);
    if (m && sel.split(",").some((part) => el.matches(part.trim()))) bg = m[1].trim();
  }
  return bg;
}

function renderFooter() {
  render(
    <GridStatsFooter
      channelRoles={{}}
      colStats={[{ mean: 1 }, { mean: 2 }]}
      statsErr={false}
      visibleCols={[0]}
      leadingSpacer={0}
      trailingSpacer={0}
      colWidth={100}
      widthOf={() => 100}
      gutterWidth={DEFAULT_GUTTER_WIDTH}
      rowHeight={22}
      textCols={[]}
    />,
  );
}

describe("stats footer legibility", () => {
  it("every footer cell is opaque, so the rows it covers do not print through", () => {
    renderFooter();
    for (const cell of screen.getAllByRole("gridcell")) {
      const bg = cell.getAttribute("style")?.includes("background") ? "inline" : footerBackground(cell);
      expect(bg).not.toBeNull();
      expect(bg).not.toMatch(/transparent|none/);
    }
  });

  it("names fit the gutter (at most 7 monospace characters at 9 px in 40 px) and the full name is the accessible name", () => {
    // 9 px JetBrains Mono advances 0.6 em = 5.4 px; the gutter leaves 44 - 2
    // (border) - 2 (padding) = 40 px.
    for (const [label] of STAT_ROWS) expect(label.length * 5.4).toBeLessThanOrEqual(DEFAULT_GUTTER_WIDTH - 4);
    renderFooter();
    expect(screen.getByRole("rowheader", { name: "Standard error of the mean" })).toHaveTextContent("SEM");
    expect(screen.getByRole("rowheader", { name: "Variance" })).toHaveTextContent("Var");
    expect(screen.getByRole("rowheader", { name: "Missing (blank or non-numeric cells)" })).toHaveAttribute(
      "title",
      expect.stringMatching(/^Missing/),
    );
  });
});
