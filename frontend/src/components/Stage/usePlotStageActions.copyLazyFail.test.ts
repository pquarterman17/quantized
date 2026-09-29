// P3.4: a failed chunk load behind the Stage's Copy figure / Copy figure as
// SVG actions shows the standard "Could not load the …" toast and leaves no
// busy entry behind (runLazy). Its own file because the failing module mock
// would break the success cases in usePlotStageActions.copyLazy.test.ts.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePendingOps } from "../../store/pendingOps";
import { useToasts } from "../../store/toasts";
import { usePlotStageActions } from "./usePlotStageActions";

vi.mock("../../lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/clipboard")>()),
  clipboardSvgSupported: () => true,
}));
vi.mock("../../lib/copyFigureCommand", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

beforeEach(() => {
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
});

describe("Stage copy actions when their chunk fails to load (P3.4)", () => {
  it.each(["copyFigure", "copyFigureSvg"] as const)(
    "%s reports the failure and leaves no busy entry",
    async (key) => {
      const a = renderHook(() => usePlotStageActions({ current: null }, null, null)).result.current;
      a[key]?.();
      await vi.waitFor(() =>
        expect(useToasts.getState().toasts.map((t) => [t.kind, t.msg])).toEqual([
          ["danger", expect.stringMatching(/^Could not load the figure copy: /)],
        ]),
      );
      expect(usePendingOps.getState().ops).toEqual([]);
    },
  );
});
