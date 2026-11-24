import { describe, expect, it, vi } from "vitest";

import type { Action } from "../../store/commands";
import { buildAppActions } from "../../appCommands";
import { useApp } from "../../store/useApp";
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

  // Figures audit #18: Origin users look for figure export under File.
  it("cross-lists figure export, publication preview and page setup under File > Export", () => {
    const run = vi.fn();
    const actions: Action[] = [
      { id: "export-csv", group: "File", label: "Export CSV…", run: vi.fn() },
      { id: "export-figure", group: "Plot", section: "Build & export", label: "Export figure…", run },
      { id: "figure-builder", group: "Plot", section: "Build & export", label: "Publication preview…", run: vi.fn() },
      { id: "page-setup", group: "Plot", section: "Layout", label: "Page setup…", run: vi.fn() },
      { id: "autoscale", group: "Plot", label: "Autoscale", run: vi.fn() },
    ];
    const file = buildAppMenuItems("File", actions, fmt);
    const exportMenu = file.find((item) => "label" in item && item.label === "Export");
    expect(exportMenu).toMatchObject({
      // UX11 N4: grouped with separators (data, figure, publication and page).
      submenu: [
        expect.objectContaining({ label: "Export CSV…" }),
        { separator: true },
        expect.objectContaining({ label: "Export figure…" }),
        { separator: true },
        expect.objectContaining({ label: "Publication preview…" }),
        expect.objectContaining({ label: "Page setup…" }),
      ],
    });
    expect(JSON.stringify(file)).not.toContain("Autoscale"); // another menu's own command stays there
    // UX10 P1-3: listed once. Plot no longer repeats them; its own commands stay.
    const plot = buildAppMenuItems("Plot", actions, fmt);
    expect(JSON.stringify(plot)).not.toContain("Export figure");
    expect(JSON.stringify(plot)).not.toContain("Page setup");
    expect(plot).toContainEqual(expect.objectContaining({ label: "Autoscale" }));
  });

  it("leaves a palette-only deep link out of every menu (its parent command is already there)", () => {
    const actions: Action[] = [
      { id: "signal-processing", group: "Analyze", label: "Signal Processing…", run: vi.fn() },
      { id: "signal-derivative", group: "Analyze", label: "Derivative · dY/dX", paletteOnly: true, run: vi.fn() },
    ];
    expect(JSON.stringify(buildAppMenuItems("Analyze", actions, fmt))).toContain("Signal Processing");
    expect(JSON.stringify(buildAppMenuItems("Analyze", actions, fmt))).not.toContain("Derivative");
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

// UX audit 8 #6 / lane UX8-F: menu structure against the REAL registry.
describe("real menu structure (findability)", () => {
  const real = buildAppActions(useApp.getState);
  const menu = (group: string) => buildAppMenuItems(group, real, fmt);
  const flyout = (group: string, label: string) =>
    (menu(group).find((i) => "label" in i && i.label === label) as { submenu?: { label?: string }[] } | undefined)?.submenu?.map((i) => i.label);

  it("Analyze > Fit lists Curve fit (and keeps it at the root)", () => {
    expect(flyout("Analyze", "Fit")).toContain("Curve fit…");
    expect(menu("Analyze")).toContainEqual(expect.objectContaining({ label: "Curve fit…" }));
  });

  it("Analyze > Peaks & baseline lists Peak analyzer (and keeps it at the root)", () => {
    expect(flyout("Analyze", "Peaks & baseline")).toContain("Peak analyzer…");
    expect(menu("Analyze")).toContainEqual(expect.objectContaining({ label: "Peak analyzer…" }));
  });

  it("the Workflow flyout is Tools", () => {
    expect(flyout("Analyze", "Workflow")).toBeUndefined();
    // UX10 P1-3: the digitizer and calculators are not analysis of the active data: own Tools menu.
    expect(flyout("Analyze", "Tools")).toBeUndefined();
    expect(menu("Tools").map((i) => ("label" in i ? i.label : undefined))).toEqual(
      expect.arrayContaining(["Graph digitizer…"]),
    );
  });

  it("Edit offers Copy figure and Select all datasets", () => {
    const labels = menu("Edit").map((i) => ("label" in i ? i.label : undefined));
    expect(labels).toEqual(expect.arrayContaining(["Copy figure", "Select all datasets"]));
  });

  it("Data carries Set Column Values… and Dataset math", () => {
    const all = (menu("Data") as { label?: string; submenu?: { label?: string }[] }[]).flatMap((i) => [i.label, ...(i.submenu?.map((s) => s.label) ?? [])]);
    expect(all).toEqual(expect.arrayContaining(["Set column values…", "Dataset math…"]));
  });
});
