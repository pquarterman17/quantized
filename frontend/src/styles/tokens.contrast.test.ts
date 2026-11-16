// WCAG contrast of the key design-token pairs, both themes (UX audit 7, G1).
// The audit measured --text-faint at 2.7-4.0:1 and the light theme's card /
// border steps at 1.13-1.17:1. Reads `styles/colors.css` as text (the
// seriesPalette.cvd.test.ts technique) and decodes the oklch() tokens with a
// small canvas-free converter, because the node `canvas` package silently
// ignores oklch() (see that file's header), so nothing here may paint a pixel.
//
// Thresholds: text 4.5:1 (WCAG 1.4.3 AA); a UI-component boundary that carries
// meaning (input / select outline) 3:1 (1.4.11); the quiet card hairline and
// the surface step only need to be perceptible, not 3:1 — they are decorative
// separators, so they get floors of 1.35 and 1.15 (measured: the old light
// values were 1.17 and 1.13).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "colors.css"), "utf8");

type Tokens = Record<string, [number, number, number]>;

/** The declarations inside the first block whose selector text starts with `head`. */
function block(head: string): string {
  const at = CSS.indexOf(head);
  if (at < 0) throw new Error(`no block ${head}`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

function tokensIn(body: string): Tokens {
  const out: Tokens = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  // opaque oklch(L C H) only — alpha tokens (accent-soft, glass) are not text/surface pairs
  for (const m of clean.matchAll(/(--[a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const DARK = tokensIn(block(':root,\n[data-theme="dark"]'));
const LIGHT = tokensIn(block('[data-theme="light"] {'));

function srgbLuminance([l, c, h]: [number, number, number]): number {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const L = (l + 0.3963377773761749 * a + 0.2158037573099136 * b) ** 3;
  const M = (l - 0.1055613458156586 * a - 0.0638541728258133 * b) ** 3;
  const S = (l - 0.0894841775298119 * a - 1.2914855480194092 * b) ** 3;
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG 2.x contrast ratio of two tokens. */
function ratio(t: Tokens, fg: string, bg: string): number {
  if (!t[fg] || !t[bg]) throw new Error(`missing token ${fg} or ${bg}`);
  const [hi, lo] = [srgbLuminance(t[fg]), srgbLuminance(t[bg])].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: [string, Tokens][] = [
  ["dark", DARK],
  ["light", LIGHT],
];
const SURFACES_0_2 = ["--surface-0", "--surface-1", "--surface-2"];

describe("token contrast (WCAG)", () => {
  it("decodes every token the pairs below use, in both themes", () => {
    for (const [, t] of THEMES) {
      for (const k of ["--text", "--text-dim", "--text-faint", "--surface-0", "--surface-3", "--border-soft", "--border-strong", "--ok", "--danger", "--warn", "--accent-text"]) {
        expect(t[k], k).toBeDefined();
      }
    }
  });

  for (const [name, t] of THEMES) {
    describe(`${name} theme`, () => {
      for (const s of SURFACES_0_2) {
        for (const fg of ["--text", "--text-dim", "--text-faint", "--accent-text", "--ok", "--danger", "--warn"]) {
          it(`${fg} on ${s} is >= 4.5:1`, () => {
            expect(ratio(t, fg, s)).toBeGreaterThanOrEqual(4.5);
          });
        }
        it(`--border-strong (control outline) vs ${s} is >= 3:1`, () => {
          expect(ratio(t, "--border-strong", s)).toBeGreaterThanOrEqual(3);
        });
      }
      it("primary and secondary text stay AA on the hover surface (surface-3)", () => {
        expect(ratio(t, "--text", "--surface-3")).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t, "--text-dim", "--surface-3")).toBeGreaterThanOrEqual(4.5);
      });
      it("faint text keeps a real hierarchy step below dim text", () => {
        expect(ratio(t, "--text-faint", "--surface-1")).toBeLessThan(ratio(t, "--text-dim", "--surface-1"));
      });
    });
  }

  // Dark surfaces separate by lightness alone and read fine; it was the LIGHT
  // theme whose cards and hairlines vanished (1.13-1.17:1), so only it is floored.
  it("light: the card hairline is perceptible against surface-1 (>= 1.35:1)", () => {
    expect(ratio(LIGHT, "--border-soft", "--surface-1")).toBeGreaterThanOrEqual(1.35);
  });
  it("light: surface-2 (cards) is a visible step from surface-1 (>= 1.15:1)", () => {
    expect(ratio(LIGHT, "--surface-2", "--surface-1")).toBeGreaterThanOrEqual(1.15);
  });

  it("every dark accent scheme keeps its accent-text AA on surface-1", () => {
    for (const scheme of ["violet", "teal", "ocean", "amber", "rose"]) {
      const t = { ...DARK, ...tokensIn(block(`[data-theme="dark"][data-accent="${scheme}"]`)) };
      expect(ratio(t, "--accent-text", "--surface-1"), scheme).toBeGreaterThanOrEqual(4.5);
    }
  });
});
