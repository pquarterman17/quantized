import { afterEach, describe, expect, it, vi } from "vitest";

import { getFigureViewLabel, openPublicationPreview, resetFigureViewLabel } from "./exportFigureView";
import type { StoreGet } from "./exportActive";

/** A store stub: `begin` is what beginFigurePublicationEdit returns, and it
 *  opens the view when it succeeds. */
function stub(begin: boolean) {
  const state = {
    figureBuilderOpen: false,
    figurePublicationSession: null,
    datasets: [],
    activeId: null,
    setStatus: vi.fn(),
    setFigureBuilderOpen: vi.fn(),
    beginFigurePublicationEdit: () => {
      if (begin) state.figureBuilderOpen = true;
      return begin;
    },
  };
  return (() => state) as unknown as StoreGet;
}

afterEach(resetFigureViewLabel);

describe("export view label", () => {
  it("defaults to Publication preview", () => {
    expect(getFigureViewLabel()).toBe("Publication preview");
  });

  it("is 'Export figure' when opened from Export figure…", () => {
    openPublicationPreview(stub(true), "Export figure");
    expect(getFigureViewLabel()).toBe("Export figure");
  });

  it("does not leak when the open is refused", () => {
    openPublicationPreview(stub(false), "Export figure");
    expect(getFigureViewLabel()).toBe("Publication preview");
  });
});
