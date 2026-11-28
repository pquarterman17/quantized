// Acceptance pass 15 U5: saving a style template under a name that is already saved asks before replacing it.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadGraphTemplates } from "../../../lib/figuredoc";
import { defaultPlotView } from "../../../lib/plotview";
import { askConfirm } from "../../../store/confirmDialog";
import type { LegacyFigureState } from "./legacyFigure";
import { useGraphTemplates, type CanonicalTemplateTarget } from "./useGraphTemplates";

vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn() }));

const target = (style: string): CanonicalTemplateTarget => ({
  style, overrides: {}, view: defaultPlotView(), plotted: [0], setStyle: vi.fn(), setOverrides: vi.fn(), setView: vi.fn(),
});
const hook = (style: string) =>
  renderHook(() =>
    useGraphTemplates({
      legacy: { data: null } as unknown as LegacyFigureState,
      setStyle: vi.fn(), setOverrides: vi.fn(), setDocSeriesStyles: vi.fn(), setStatus: vi.fn(),
      canonical: target(style),
    }),
  );
const styleOf = () => loadGraphTemplates().find((t) => t.name === "tA")?.style;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(askConfirm).mockReset();
});

describe("saving a style template under an existing name", () => {
  it("saves a new name without asking", () => {
    const { result } = hook("nature");
    act(() => result.current.saveStyleTemplate("tA"));
    expect(askConfirm).not.toHaveBeenCalled();
    expect(styleOf()).toBe("nature");
  });

  it("asks first, and Cancel keeps the saved template", async () => {
    const first = hook("nature");
    act(() => first.result.current.saveStyleTemplate("tA"));
    vi.mocked(askConfirm).mockResolvedValue(false);
    const { result } = hook("science");
    act(() => result.current.saveStyleTemplate("tA"));
    await waitFor(() => expect(vi.mocked(askConfirm).mock.calls.length).toBe(1));
    expect(vi.mocked(askConfirm).mock.calls[0][0]).toBe('Replace graph template "tA"?');
    await Promise.resolve();
    expect(styleOf()).toBe("nature");
  });

  it("replaces it once the user confirms", async () => {
    const first = hook("nature");
    act(() => first.result.current.saveStyleTemplate("tA"));
    vi.mocked(askConfirm).mockResolvedValue(true);
    const { result } = hook("science");
    act(() => result.current.saveStyleTemplate("tA"));
    await waitFor(() => expect(styleOf()).toBe("science"));
  });
});
