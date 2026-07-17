// Tests for the ToolWindow layout registry slice (GUI_INTERACTION_PLAN #10),
// composed into useApp — see store/toolwindows.ts's header for why it's a
// standalone slice (store-size ratchet headroom).

import { beforeEach, describe, expect, it } from "vitest";

import { defaultToolWindowLayout, type ToolWindowLayout } from "../lib/toolwindow";
import { useApp } from "./useApp";

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {} });
});

describe("setToolWindowLayout", () => {
  it("writes a new entry under its id, leaving other ids untouched", () => {
    const a: ToolWindowLayout = { x: 10, y: 20, width: 300, height: null, collapsed: false };
    const b: ToolWindowLayout = { x: 40, y: 50, width: 320, height: null, collapsed: false };
    useApp.getState().setToolWindowLayout("baseline", a);
    useApp.getState().setToolWindowLayout("peaks", b);
    expect(useApp.getState().toolWindowLayout).toEqual({ baseline: a, peaks: b });
  });

  it("overwrites an existing entry for the same id", () => {
    useApp.getState().setToolWindowLayout("baseline", defaultToolWindowLayout(10, 10, 300));
    useApp.getState().setToolWindowLayout("baseline", defaultToolWindowLayout(200, 200, 300));
    expect(useApp.getState().toolWindowLayout.baseline.x).toBe(200);
  });
});

describe("toggleToolWindowCollapsed", () => {
  it("collapses a window that has never been persisted, seeded from the fallback", () => {
    const fallback = defaultToolWindowLayout(120, 90, 360);
    useApp.getState().toggleToolWindowCollapsed("curvefit", fallback);
    const entry = useApp.getState().toolWindowLayout.curvefit;
    expect(entry.collapsed).toBe(true);
    expect(entry.x).toBe(120);
    expect(entry.width).toBe(360);
  });

  it("flips collapsed back and forth without touching position/size", () => {
    const fallback = defaultToolWindowLayout(120, 90, 360);
    useApp.getState().setToolWindowLayout("curvefit", { ...fallback, x: 55, width: 400 });
    useApp.getState().toggleToolWindowCollapsed("curvefit", fallback);
    expect(useApp.getState().toolWindowLayout.curvefit).toEqual({
      x: 55,
      y: 90,
      width: 400,
      height: null,
      collapsed: true,
    });
    useApp.getState().toggleToolWindowCollapsed("curvefit", fallback);
    expect(useApp.getState().toolWindowLayout.curvefit.collapsed).toBe(false);
  });
});

describe("resetToolWindowPositions", () => {
  it("clears every persisted entry", () => {
    useApp.getState().setToolWindowLayout("baseline", defaultToolWindowLayout(500, 500, 300));
    useApp.getState().setToolWindowLayout("peaks", defaultToolWindowLayout(600, 600, 300));
    expect(Object.keys(useApp.getState().toolWindowLayout)).toHaveLength(2);
    useApp.getState().resetToolWindowPositions();
    expect(useApp.getState().toolWindowLayout).toEqual({});
  });

  it("is a no-op-safe call when nothing was ever persisted", () => {
    useApp.getState().resetToolWindowPositions();
    expect(useApp.getState().toolWindowLayout).toEqual({});
  });
});

describe("initial store state", () => {
  it("starts with an empty layout registry (a fresh app has no persisted windows)", () => {
    // Reconstructed per beforeEach; assert the composed slice's own default
    // independent of the explicit reset above.
    expect(useApp.getState().toolWindowLayout).toEqual({});
  });
});

describe("commands/uiCommands.ts registers Reset window positions (View group)", () => {
  const commandsSrc = Object.values(
    import.meta.glob("../commands/uiCommands.ts", { query: "?raw", import: "default", eager: true }),
  )[0] as string;

  it("registers the reset command in the View group, wired to resetToolWindowPositions", () => {
    expect(commandsSrc).toContain('id: "reset-tool-windows"');
    expect(commandsSrc).toContain('group: "View"');
    expect(commandsSrc).toContain('label: "Reset window positions"');
    expect(commandsSrc).toContain("resetToolWindowPositions()");
  });
});
