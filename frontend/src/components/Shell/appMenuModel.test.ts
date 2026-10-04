import { describe, expect, it, vi } from "vitest";

import type { Action } from "../../store/commands";
import { buildAppMenuItems } from "./appMenuModel";

const fmt = (s: string) => `key:${s}`;

describe("buildAppMenuItems", () => {
  it("keeps common actions visible and folds topic sections into shallow flyouts", () => {
    const actions: Action[] = [
      {
        id: "autoscale",
        group: "Plot",
        section: "Axes",
        label: "Autoscale",
        run: vi.fn(),
      },
      {
        id: "xLog",
        group: "Plot",
        section: "Axes",
        label: "X scale",
        run: vi.fn(),
      },
      {
        id: "waterfall",
        group: "Plot",
        section: "Layout",
        label: "Waterfall",
        run: vi.fn(),
      },
    ];
    const items = buildAppMenuItems("Plot", actions, fmt);
    expect(items[0]).toMatchObject({ label: "Autoscale" });
    expect(items).toContainEqual({ separator: true });
    expect(items).toContainEqual(
      expect.objectContaining({
        label: "Axes",
        submenu: [expect.objectContaining({ label: "X scale" })],
      }),
    );
    expect(items).toContainEqual(expect.objectContaining({ label: "Layout" }));
  });

  it("evaluates live checked and disabled state and places danger actions last", () => {
    let checked = false;
    const actions: Action[] = [
      {
        id: "left",
        group: "View",
        label: "Library",
        checked: () => checked,
        run: vi.fn(),
      },
      {
        id: "blocked",
        group: "View",
        label: "Blocked",
        disabled: () => true,
        disabledReason: "Open data first",
        run: vi.fn(),
      },
      {
        id: "remove-all",
        group: "File",
        label: "Remove all…",
        danger: true,
        run: vi.fn(),
      },
    ];
    checked = true;
    const view = buildAppMenuItems("View", actions.slice(0, 2), fmt);
    expect(view[0]).toMatchObject({ label: "Library", checked: true });
    expect(view[1]).toMatchObject({
      label: "Blocked",
      disabled: true,
      title: "Open data first",
    });
    const file = buildAppMenuItems("File", actions.slice(2), fmt);
    expect(file.at(-1)).toMatchObject({ label: "Remove all…", danger: true });
  });

  it("formats shortcut hints without changing action behavior", () => {
    const run = vi.fn();
    const [item] = buildAppMenuItems(
      "Edit",
      [{ id: "palette", group: "Edit", label: "Palette", shortcut: "⌘K", run }],
      fmt,
    );
    expect(item).toMatchObject({ shortcutLabel: "key:⌘K" });
    if ("run" in item) item.run();
    expect(run).toHaveBeenCalledOnce();
  });
});
