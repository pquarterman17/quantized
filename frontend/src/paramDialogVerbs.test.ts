// Every parameter dialog says what its confirm button does (figures
// integration live check: Export figure, Page setup, Rename, Add tag ... all
// read the generic "Run"). `askParams` now REQUIRES a `confirmLabel` (the
// type enforces it); this scan keeps a call from slipping through an `as`
// cast or a spread, and keeps "Run" from creeping back as the fallback.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** The argument text of each `askParams(` call (balanced parentheses). */
function calls(text: string): string[] {
  const out: string[] = [];
  let at = text.indexOf("askParams(");
  while (at >= 0) {
    let depth = 0;
    let i = at + "askParams".length;
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) break;
    }
    out.push(text.slice(at, i + 1));
    at = text.indexOf("askParams(", i);
  }
  return out;
}

describe("parameter dialogs name their confirm verb", () => {
  it("every askParams call passes a confirmLabel", () => {
    const missing: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const c of calls(text)) {
        if (/^askParams\(\s*title: string|^askParams\(\)|^askParams\(title, fields\)/.test(c)) continue; // docs / the definition
        if (!c.includes("confirmLabel")) missing.push(`${file.slice(SRC.length)}: ${c.slice(0, 60)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the dialog's fallback is not the generic Run", () => {
    const body = readFileSync(join(SRC, "components/overlays/ParamDialogBody.tsx"), "utf8");
    expect(body).not.toMatch(/confirmLabel \?\? "Run"/);
  });
});
