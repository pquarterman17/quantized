import { describe, expect, it } from "vitest";

import {
  FIGURE_CONFIG_FIELD_CONTRACT,
  FIGURE_DOC_FIELD_CONTRACT,
  FIGURE_FIELD_CONTRACTS,
  FIGURE_SPEC_FIELD_CONTRACT,
  PLOT_SPEC_FIELD_CONTRACT,
  PLOT_VIEW_FIELD_CONTRACT,
} from "./figureContract";

describe("figure authoring contract census", () => {
  it("includes all five current figure models", () => {
    expect(Object.keys(FIGURE_FIELD_CONTRACTS)).toEqual([
      "PlotView",
      "PlotSpec",
      "FigureConfig",
      "FigureDoc",
      "FigureSpec",
    ]);
  });

  it("keeps PlotView as the canonical editable-state foundation", () => {
    expect(Object.values(PLOT_VIEW_FIELD_CONTRACT).every(
      ({ classification }) => classification === "canonical",
    )).toBe(true);
    expect(PLOT_VIEW_FIELD_CONTRACT.errKeys.mapsTo).toBe("bindings.errors");
    expect(PLOT_VIEW_FIELD_CONTRACT.y2Keys.mapsTo).toBe("bindings.y2.channels");
    expect(PLOT_VIEW_FIELD_CONTRACT.annotations.mapsTo).toBe("decor.annotations");
  });

  it("separates recipes, legacy projections, and export transport", () => {
    expect(PLOT_SPEC_FIELD_CONTRACT.zones.classification).toBe("recipe-only");
    expect(PLOT_SPEC_FIELD_CONTRACT.version.classification).toBe("derived");
    expect(FIGURE_CONFIG_FIELD_CONTRACT.overrides.classification).toBe("derived");
    expect(FIGURE_DOC_FIELD_CONTRACT.id.classification).toBe("canonical");
    expect(FIGURE_DOC_FIELD_CONTRACT.config.classification).toBe("derived");
    expect(FIGURE_SPEC_FIELD_CONTRACT.dpi.classification).toBe("export-only");
    expect(FIGURE_SPEC_FIELD_CONTRACT.x_log.classification).toBe("unsupported");
  });

  it("documents a destination or an explicit reason not to persist each field", () => {
    for (const fields of Object.values(FIGURE_FIELD_CONTRACTS)) {
      for (const contract of Object.values(fields)) {
        expect(contract.reason.trim()).not.toBe("");
        if (contract.mapsTo === null) {
          expect(["derived", "unsupported"]).toContain(contract.classification);
        } else {
          expect(contract.mapsTo.trim()).not.toBe("");
        }
      }
    }
  });
});
