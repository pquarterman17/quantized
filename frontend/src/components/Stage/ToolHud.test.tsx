import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { keyForTool } from "../../lib/plotToolKeys";
import { toolDefFor } from "../../lib/plotToolbarDefs";
import type { PlotTool } from "../../lib/uplotOpts";
import ToolHud from "./ToolHud";

const DATA_TOOLS: PlotTool[] = ["zoom", "pan", "cursor", "region", "select", "measure", "stats", "integ", "fwhm", "qfit"];

describe("ToolHud", () => {
  it("renders nothing for the pointer tool", () => {
    const { container } = render(<ToolHud tool="pointer" />);
    expect(container.querySelector(".qzk-tool-hud")).toBeNull();
  });

  it.each(DATA_TOOLS)("renders name + hint + 'Esc cancels' for %s", (tool) => {
    const def = toolDefFor(tool)!;
    const { container } = render(<ToolHud tool={tool} />);
    const hud = container.querySelector(".qzk-tool-hud");
    expect(hud).not.toBeNull();
    expect(hud!.textContent).toContain(def.name);
    expect(hud!.textContent).toContain(def.hint ?? def.desc);
    expect(hud!.textContent).toContain("Esc cancels");
  });

  it("shows the shortcut chip only for tools that have one", () => {
    const { container: withKey } = render(<ToolHud tool="fwhm" />);
    expect(withKey.querySelector(".key")?.textContent).toBe(keyForTool("fwhm"));

    const { container: withoutKey } = render(<ToolHud tool="qfit" />);
    expect(keyForTool("qfit")).toBeNull();
    expect(withoutKey.querySelector(".key")).toBeNull();
  });

  it("uses the ∩ glyph and 'Peak / FWHM' name for fwhm — matches the plan's worked example", () => {
    const { container } = render(<ToolHud tool="fwhm" />);
    expect(container.querySelector(".g")?.textContent).toBe("∩");
    expect(container.querySelector(".name")?.textContent).toBe("Peak / FWHM");
  });
});
