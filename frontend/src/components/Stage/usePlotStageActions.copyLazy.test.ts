// P3.4: the Stage's two publication-copy actions (Copy figure / Copy figure
// as SVG) load lib/copyFigureCommand on click. That chunk load now runs
// through runLazy, like every other click-deferred import: a busy entry in
// the shared StatusBar location while it loads. The copy itself registers
// its own cancellable op inside exportActive. The failed-load half lives in
// usePlotStageActions.copyLazyFail.test.ts, because a throwing module mock
// would break this file's success cases.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePendingOps } from "../../store/pendingOps";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { usePlotStageActions } from "./usePlotStageActions";

vi.mock("../../lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/clipboard")>()),
  clipboardSvgSupported: () => true,
}));
vi.mock("../../lib/copyFigureCommand", () => ({
  runCopyFigureCommand: () => useApp.getState().setStatus("ran raster"),
  runCopyFigureSvgCommand: () => useApp.getState().setStatus("ran vector"),
}));

beforeEach(() => {
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  useApp.setState({ status: "" });
});

describe("Stage copy actions load their chunk through runLazy (P3.4)", () => {
  it.each([
    ["copyFigure", "raster"],
    ["copyFigureSvg", "vector"],
  ] as const)("%s shows a busy entry while the chunk loads, then runs the copy", async (key, kind) => {
    const a = renderHook(() => usePlotStageActions({ current: null }, null, null)).result.current;
    a[key]?.();
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Loading figure copy…"]);
    await vi.waitFor(() => expect(useApp.getState().status).toBe(`ran ${kind}`));
    expect(usePendingOps.getState().ops).toEqual([]);
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
