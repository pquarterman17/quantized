// CSS-only fixes (jsdom does not lay out, so these pin the rules themselves):
// the map toolbar's "2θ/ω" text button must not wrap inside a fixed 32px box,
// and the Library row's hover "+" must not sit on top of a long name.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell.css"), "utf8");

it("a toolbar text button grows past 32px and never wraps", () => {
  const rule = /^\.qzk-tool-btn \{([^}]*)\}/m.exec(css)![1];
  expect(rule).toMatch(/min-width:\s*32px/);
  expect(rule).not.toMatch(/(^|[\s;])width:\s*32px/);
  expect(rule).toMatch(/white-space:\s*nowrap/);
});

it("a hovered compact Library row keeps its name's ellipsis clear of the + button", () => {
  expect(css).toMatch(/\.qzk-ds:hover:has\(\.qzk-ds-tags-resting\) \.qzk-ds-compact-row > \.qzk-ds-name[^}]*padding-right/);
});
