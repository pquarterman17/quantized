// Plot audit round 3: the data-cursor readout and a bottom-right legend took
// the same spot (both bottom: 12px; right: 12px), so hovering a plot whose
// legend sat in that corner hid the legend's last rows under the readout.
// jsdom cascades `:has()` but cannot parse all of shell.css, so this loads
// shell.css's own `.qzk-readout` rules and checks where they put the readout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const shellCss = readFileSync(join(__dirname, "../../styles/shell.css"), "utf8");

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = shellCss
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .filter((rule) => /qzk-readout/.test(rule.split("{")[0]) && !rule.includes("@"))
    .map((rule) => `${rule}}`)
    .join("\n");
  document.head.appendChild(style);
});

function readoutSide(legendClass: string, lc?: string): string {
  document.body.innerHTML =
    `<div class="qzk-stage"${lc ? ` data-lc="${lc}"` : ""}>` +
    `<div class="qzk-glass qzk-readout">x = 1</div><div class="qzk-glass qzk-legend ${legendClass}"></div></div>`;
  const cs = getComputedStyle(document.querySelector(".qzk-readout")!);
  if (cs.bottom !== "12px") return `unstyled(${cs.bottom})`;
  return cs.left !== "auto" && cs.left !== "" ? "left" : "right";
}

describe("cursor readout vs legend", () => {
  it("keeps the bottom-right corner when the legend is elsewhere", () => {
    expect(readoutSide("ne")).toBe("right");
    expect(readoutSide("sw")).toBe("right");
    expect(readoutSide("auto", "nw")).toBe("right");
  });

  it("moves to the bottom left when the legend sits bottom right", () => {
    expect(readoutSide("se")).toBe("left");
    expect(readoutSide("auto", "se")).toBe("left");
    expect(readoutSide("out")).toBe("left");
  });
});
