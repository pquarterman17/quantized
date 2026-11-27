import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { mapExporterFor, STAGE_MAP_KEY } from "../../lib/mapExportBridge";
import { useRegisterMapExporter } from "./useRegisterMapExporter";

describe("useRegisterMapExporter", () => {
  it("registers under the window id, calls the latest closure, and unregisters on unmount", () => {
    const first = vi.fn(), second = vi.fn();
    const { rerender, unmount } = renderHook(({ run }) => useRegisterMapExporter("win-1", run), { initialProps: { run: first } });
    rerender({ run: second });
    mapExporterFor("win-1")!();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(mapExporterFor(STAGE_MAP_KEY)).toBeNull();
    unmount();
    expect(mapExporterFor("win-1")).toBeNull();
  });

  it("a window without an id is the classic Map tab; two maps on one key keep the newest, and the older one's unmount leaves it", () => {
    const a = vi.fn(), b = vi.fn();
    const one = renderHook(() => useRegisterMapExporter(undefined, a));
    const two = renderHook(() => useRegisterMapExporter(undefined, b));
    mapExporterFor(STAGE_MAP_KEY)!();
    expect(b).toHaveBeenCalledTimes(1);
    one.unmount();
    expect(mapExporterFor(STAGE_MAP_KEY)).not.toBeNull();
    two.unmount();
    expect(mapExporterFor(STAGE_MAP_KEY)).toBeNull();
  });
});
