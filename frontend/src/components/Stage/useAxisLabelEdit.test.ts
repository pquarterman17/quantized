import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ContextMenuItem } from "../overlays/ContextMenu";
import { useApp } from "../../store/useApp";
import { useAxisLabelEdit } from "./useAxisLabelEdit";

const ORIGINAL = useApp.getState();
afterEach(() => useApp.setState(ORIGINAL, true));

/** Narrow a menu item to a submenu-bearing one. */
function sub(items: ContextMenuItem[], label: string): ContextMenuItem[] {
  const it = items.find((i) => "label" in i && i.label === label);
  if (!it || !("submenu" in it)) throw new Error(`no submenu ${label}`);
  return it.submenu;
}

describe("useAxisLabelEdit", () => {
  it("bridge carries offsets/styles and is interactive only in the pointer tool", () => {
    useApp.setState({ axisLabelStyles: { y: { size: 18, bold: true } } });
    const { result } = renderHook(() => useAxisLabelEdit("zoom"));
    expect(result.current.bridge.interactive).toBe(false);
    expect(result.current.bridge.styles).toEqual({ y: { size: 18, bold: true } });
    const { result: pointer } = renderHook(() => useAxisLabelEdit("pointer"));
    expect(pointer.current.bridge.interactive).toBe(true);
  });

  it("onContextMenu opens a Format menu whose toggles + size drive the store", () => {
    const { result } = renderHook(() => useAxisLabelEdit("pointer"));
    expect(result.current.menu).toBeNull();
    act(() => result.current.bridge.onContextMenu("y", 100, 200));
    const menu = result.current.menu!;
    expect(menu).toMatchObject({ x: 100, y: 200 });

    const format = sub(menu.items, "Format");
    const size = sub(format, "Size");
    // Italic toggle flips the store.
    const italic = format.find((i) => "label" in i && i.label === "Italic") as {
      run: () => void;
      checked?: boolean;
    };
    expect(italic.checked).toBeFalsy();
    act(() => italic.run());
    expect(useApp.getState().axisLabelStyles.y?.italic).toBe(true);
    // A size preset sets the size.
    const px18 = size.find((i) => "label" in i && i.label === "18 px") as { run: () => void };
    act(() => px18.run());
    expect(useApp.getState().axisLabelStyles.y?.size).toBe(18);
  });
});
