// Figures-audit B2: style templates in the CANONICAL Publication preview
// (before the fix they existed only in legacy mode, so the default preview
// could neither save nor apply one).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadGraphTemplates, saveGraphTemplate } from "../../../lib/figuredoc";
import { sanitizeGraphFormat } from "../../../lib/graphFormat";
import { defaultPlotView } from "../../../lib/plotview";
import type { LegacyFigureState } from "./legacyFigure";
import { useGraphTemplates, type CanonicalTemplateTarget } from "./useGraphTemplates";

function target(over: Partial<CanonicalTemplateTarget> = {}): CanonicalTemplateTarget {
  return {
    style: "nature",
    overrides: { font_size: 7 },
    view: { ...defaultPlotView(), yScale: "log", seriesStyles: { 3: { color: "#ff0000", width: 2 } } },
    plotted: [3],
    setStyle: vi.fn(),
    setOverrides: vi.fn(),
    setView: vi.fn(),
    ...over,
  };
}

function hook(canonical: CanonicalTemplateTarget) {
  return renderHook(() =>
    useGraphTemplates({
      legacy: { data: null } as unknown as LegacyFigureState,
      setStyle: vi.fn(),
      setOverrides: vi.fn(),
      setDocSeriesStyles: vi.fn(),
      setStatus: vi.fn(),
      canonical,
    }),
  );
}

beforeEach(() => localStorage.clear());

describe("canonical graph templates", () => {
  it("saves the draft's preset, overrides and Stage format", () => {
    const { result } = hook(target());
    act(() => result.current.saveStyleTemplate("House"));
    const saved = loadGraphTemplates().find((t) => t.name === "House");
    expect(saved?.style).toBe("nature");
    expect(saved?.overrides).toEqual({ font_size: 7 });
    const format = sanitizeGraphFormat(saved?.format);
    expect(format?.yScale).toBe("log");
    expect(format?.series).toEqual([{ color: "#ff0000", width: 2 }]);
  });

  it("applies a template onto another draft's series by position, through the draft setters", () => {
    saveGraphTemplate({ name: "Pub", style: "aps", overrides: { font_size: 9 }, seriesStyles: [{ color: "#00ff00", width: 3 }] });
    const t = target({ plotted: [0, 1], view: { ...defaultPlotView(), seriesStyles: {} } });
    const { result } = hook(t);
    act(() => result.current.applyStyleTemplate("Pub"));
    expect(t.setStyle).toHaveBeenCalledWith("aps");
    expect(t.setOverrides).toHaveBeenCalledWith({ font_size: 9 });
    expect(vi.mocked(t.setView).mock.calls[0][0].seriesStyles).toEqual({ 0: { color: "#00ff00", width: 3 } });
  });
});
