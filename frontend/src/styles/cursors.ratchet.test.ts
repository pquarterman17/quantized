// Ratchet (UX audit 7, lane G2): the design guide says "cursors are default"
// — this is a desktop-style tool, not a web page, so controls never switch to
// the hand. UX-G2 removed all 29 `cursor: pointer` rules; none may return in
// a stylesheet or a React `style` prop. (Canvas hit-feedback assigned from
// script, e.g. uplotAnchors, is a separate, deliberate affordance.)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("no cursor: pointer", () => {
  it("stylesheets and style props never ask for the hand cursor", () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      if (!/\.(css|tsx)$/.test(f) || /\.test\./.test(f)) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/cursor\s*:\s*["']?pointer/.test(line)) hits.push(`${relative(SRC, f)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
