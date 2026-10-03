// GUI audit (2026-09-29): stylesheet contracts for chrome that has to fit its
// container. jsdom cannot lay anything out, so these pin the RULES that make
// the layout fit; e2e/specs/layout-fit.spec.ts measures the real result at
// 100%/125% scaling and in a narrow window.

import { describe, expect, it } from "vitest";

import { flatRules, readShellCss } from "./cssRules.testkit";

const css = readShellCss();
const rules = flatRules(css);

/** Every declaration body whose selector list contains `selector` exactly. */
function bodiesFor(selector: string): string {
  return rules
    .filter((r) => r.selector.split(",").some((s) => s.trim() === selector))
    .map((r) => r.body)
    .join(";");
}

describe("plot dock + legend (P1)", () => {
  it("does not centre the dock with left:50% (that halves its available width)", () => {
    const body = bodiesFor(".qzk-float-tools");
    expect(body).not.toMatch(/translateX\(-50%\)/);
    expect(body).toMatch(/left:\s*12px/);
    expect(body).toMatch(/right:\s*12px/);
    expect(body).toMatch(/flex-wrap:\s*wrap/);
  });

  it("keeps a collapsed tool group measurable but invisible", () => {
    const body = bodiesFor(".qzk-tool-group[data-overflow]");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/visibility:\s*hidden/);
  });

  it("drops the NE legend below the dock on a stage that has one", () => {
    const body = bodiesFor(".qzk-stage:has(> .qzk-float-tools) > .qzk-legend.ne");
    expect(body).toMatch(/top:\s*72px/);
  });

  it("keeps an auto legend inside the plot frame, and narrows the plot for an outside column", () => {
    // Plot audit round 2: the auto legend is placed against the published
    // frame rect (never over the axes' tick labels), and the "out" column
    // takes room from the plot host rather than covering the data.
    expect(bodiesFor(".qzk-legend.auto")).toMatch(/var\(--qz-frame-top/);
    expect(bodiesFor(".qzk-stage:has(> .qzk-legend.out)")).toMatch(/--qz-plot-right:\s*calc\(var\(--qz-out-w/);
  });
});

describe("Graph Builder window", () => {
  it("caps every tool window at the viewport below its own top edge", () => {
    expect(bodiesFor(".qzk-win")).toMatch(/max-height:[^;]*var\(--qzk-win-top/);
  });

  it("never lets the preview flex down to nothing", () => {
    const body = bodiesFor(".qzk-graph-builder-preview .qzk-graph-preview");
    expect(body).toMatch(/flex-shrink:\s*0|flex:\s*none|flex:\s*0 0/);
    expect(body).toMatch(/min-height:\s*\d+px/);
  });

  it("scrolls the controls inside the window", () => {
    expect(bodiesFor(".qzk-graph-builder-controls")).toMatch(/overflow-y:\s*auto/);
  });
});

describe("Library row names", () => {
  it("gives the compact row's name a real minimum width", () => {
    expect(bodiesFor(".qzk-ds-compact-row > .qzk-ds-name")).toMatch(/min-width:\s*min\(/);
  });
});

describe("Quick Figure Builder", () => {
  it("responds to its container, not to the viewport", () => {
    expect(bodiesFor(".qzk-quick-builder")).toMatch(/container-type:\s*inline-size/);
    expect(css).not.toMatch(/@media[^{]*\{[^}]*\.qzk-quick-builder-grid/);
    expect(css).toMatch(/@container[^{]*\{[^}]*\.qzk-quick-builder-grid/);
  });
});
