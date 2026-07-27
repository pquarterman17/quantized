// P0.4 finding 15 (2026-07-27): "Copy figure (vector)" never rendered in the
// plot's right-click menu even though the browser's own capability probe
// (ClipboardItem.supports("image/svg+xml")) returned true. The gate itself
// (usePlotStageActions.ts's `clipboardSvgSupported()` check) was correct —
// the bug was two dropped struct fields DOWNSTREAM of it: PlotStage.tsx
// destructures usePlotStageActions()'s return value and then rebuilds an
// `actions` object LITERAL to hand to PlotStageMenus/PlotStageOverlays (the
// props PlotContextMenu ultimately reads `actions.copyFigureSvg` off of) —
// both the destructure and both `actions={{ ... }}` literals omitted
// `copyFigureSvg`, so it was always structurally `undefined` regardless of
// what the live capability probe said. "Should appear/disappear per the
// probe" degenerated into "never renders."
//
// PlotStage.tsx is deliberately not rendered here — it's the App tree's
// heaviest component (uPlot + ~40 store fields; see AppOverlays.tsx's own
// header comment on why raw-source assertions are used for things too heavy
// to mount in jsdom) — this pins the wiring at the source-text level, the
// same pattern components/overlays/TextFormatHelp.test.tsx uses for
// AppOverlays.tsx.

import { describe, expect, it } from "vitest";

const plotStageSrc = Object.values(
  import.meta.glob("./PlotStage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

describe("PlotStage.tsx — copyFigureSvg wiring (P0.4 finding 15)", () => {
  it("destructures copyFigureSvg out of usePlotStageActions()'s return value", () => {
    // The destructuring block right after the usePlotStageActions(...) call.
    const destructureBlock = plotStageSrc.slice(
      plotStageSrc.indexOf("const {"),
      plotStageSrc.indexOf("usePlotStageActions("),
    );
    expect(destructureBlock).toContain("copyFigureSvg");
  });

  it("forwards copyFigureSvg into EVERY `actions={{ ... }}` prop literal handed to a menu/overlay consumer", () => {
    const literals = [...plotStageSrc.matchAll(/actions=\{\{[^}]*\}\}/g)].map((m) => m[0]);
    // Guard the guard: PlotStage builds exactly two of these (PlotStageMenus
    // + PlotStageOverlays) — if that count ever changes, this test should be
    // revisited rather than silently checking zero or a stale subset.
    expect(literals.length).toBeGreaterThanOrEqual(2);
    for (const literal of literals) {
      expect(literal).toContain("copyFigureSvg");
    }
  });
});
