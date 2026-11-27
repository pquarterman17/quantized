import { afterEach, describe, expect, it } from "vitest";

import { keyPalette } from "./plotKeyPalette";

const lum = (hex: string): number => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

afterEach(() => { document.documentElement.removeAttribute("data-theme"); document.body.innerHTML = ""; });

describe("overlay key palette", () => {
  it("is dark box + light ink in the dark scheme and the reverse in light (no theme-invariant light box)", () => {
    document.documentElement.dataset.theme = "dark";
    const dark = keyPalette({} as never);
    document.documentElement.dataset.theme = "light";
    const light = keyPalette({} as never);
    expect(lum(dark.bg)).toBeLessThan(0.3);
    expect(lum(dark.ink)).toBeGreaterThan(0.7);
    expect(lum(light.bg)).toBeGreaterThan(0.7);
    expect(lum(light.ink)).toBeLessThan(0.3);
  });

  it("follows the background actually behind the plot (a window pinned light inside a dark app)", () => {
    document.documentElement.dataset.theme = "dark";
    const host = document.createElement("div");
    host.style.background = "rgb(247, 247, 250)";
    const root = document.createElement("div");
    host.appendChild(root);
    document.body.appendChild(host);
    const p = keyPalette({ root, axes: [{ stroke: "#222222" }] } as never);
    expect(p.bg).toBe("rgb(247, 247, 250)");
    expect(p.ink).toBe("#222222");
  });
});
