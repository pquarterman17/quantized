// FigureDoc ids minted by "Save as figure" must come from the workspace's ONE
// id sequence (store/idSeq.ts), the same one `duplicateFigureDoc` uses via
// `nextFigureDocId`. A private `figd-` counter in useFigureBuilder.ts restarted
// at 1 beside the shared one, so in the same millisecond the two minted the
// SAME `figd-<t36>-1` and a saved project held two docs under one id.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/figures", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
  renderFigureHitmap: vi.fn().mockResolvedValue(null),
}));

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[1], [2], [3]],
  labels: ["A"],
  units: ["u"],
  metadata: {},
};

afterEach(() => {
  vi.useRealTimers();
});

describe("useFigureBuilder figd- ids", () => {
  it("after a reload, Save as figure never re-mints an id the shared sequence already handed out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    // A reload: every module-level counter starts again from zero.
    vi.resetModules();
    const { nextFigureDocId } = await import("../../../store/idSeq");
    const { useApp } = await import("../../../store/useApp");
    const { useFigureBuilder } = await import("./useFigureBuilder");

    // The id a duplicated figure doc was saved under, in the same millisecond.
    const savedId = nextFigureDocId();
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: DATA }], activeId: "d1", figureDocs: [] });

    const { result } = renderHook(() => useFigureBuilder());
    act(() => result.current.saveAsFigure("Fig", true));
    const minted = useApp.getState().figureDocs.at(-1)?.id;

    expect(minted).toMatch(/^figd-[0-9a-z]+-\d+$/);
    expect(minted).not.toBe(savedId);
  });
});
