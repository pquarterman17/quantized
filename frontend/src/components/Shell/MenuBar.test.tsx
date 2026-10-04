import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MenuBar from "./MenuBar";
import { PALETTE_LABEL, useCommands, type Action } from "../../store/commands";
import { pressEscape } from "../../test/pressEscape";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

const actions: Action[] = [
  { id: "imp", group: "File", label: "Import data…", run: vi.fn() },
  { id: "pal", group: "Edit", label: PALETTE_LABEL, run: vi.fn() },
  {
    id: "merge",
    group: "Data",
    label: "Merge selected datasets",
    run: vi.fn(),
  },
  { id: "auto", group: "Plot", label: "Autoscale / reset view", run: vi.fn() },
  { id: "fit", group: "Analyze", label: "Curve fit…", run: vi.fn() },
  { id: "thm", group: "View", label: "Toggle theme", run: vi.fn() },
];

beforeEach(() => useCommands.setState({ menuCommands: [] }));
afterEach(() => useCommands.setState({ menuCommands: [] }));

async function warmMenus(): Promise<void> {
  fireEvent.pointerEnter(screen.getByRole("menubar"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openMenu(label: string): Promise<void> {
  await warmMenus();
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  await screen.findByRole("menu");
}

describe("MenuBar", () => {
  it("renders the nine-menu structure (File·Edit·Data·Plot·Insert·Analyze·Window·View + Help)", () => {
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    for (const m of [
      "File",
      "Edit",
      "Data",
      "Plot",
      "Insert",
      "Analyze",
      "Window",
      "View",
      "Help",
    ]) {
      expect(screen.getByText(m)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("menubar", { name: "Application menu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "File" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("preloads its model so a direct click cannot leave an empty expanded menu", async () => {
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "File" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Import data…" })).toBeVisible();
  });

  it("merges published command-registry entries (e.g. Window commands) into the matching menu", async () => {
    useCommands.setState({
      menuCommands: [
        {
          id: "window-new",
          group: "Window",
          label: "New Graph Window",
          run: vi.fn(),
        },
      ],
    });
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    await openMenu("Window");
    expect(screen.getByText("New Graph Window")).toBeInTheDocument();
  });

  it("opens a menu and runs an item, scoped to that group", async () => {
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    await openMenu("Plot");
    expect(screen.getByText("Autoscale / reset view")).toBeInTheDocument();
    // Plot's popup shows only Plot items, not Data's.
    expect(screen.queryByText("Merge selected datasets")).toBeNull();

    fireEvent.click(screen.getByText("Data"));
    fireEvent.click(screen.getByText("Merge selected datasets"));
    expect(actions[2].run as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it("the Help menu offers the command palette under the SAME label as the Edit menu", async () => {
    // #17: this test previously clicked the literal "Command palette" while
    // the Edit-menu fixture above said "Command palette…" — it DOCUMENTED the
    // label divergence instead of catching it. Both now resolve through
    // PALETTE_LABEL, so a future edit cannot reintroduce the mismatch here.
    const onOpenPalette = vi.fn();
    render(<MenuBar actions={actions} onOpenPalette={onOpenPalette} />);
    await openMenu("Help");
    const entries = screen.getAllByText(PALETTE_LABEL);
    fireEvent.click(entries[entries.length - 1]);
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
  it("turns long-menu sections into shallow task flyouts", async () => {
    const sectioned: Action[] = [
      {
        id: "cf",
        group: "Analyze",
        section: "Fit",
        label: "Curve fit…",
        run: vi.fn(),
      },
      {
        id: "pk",
        group: "Analyze",
        section: "Peaks & baseline",
        label: "Find peaks…",
        run: vi.fn(),
      },
      {
        id: "bl",
        group: "Analyze",
        section: "Peaks & baseline",
        label: "Baseline…",
        run: vi.fn(),
      },
    ];
    render(<MenuBar actions={sectioned} onOpenPalette={vi.fn()} />);
    await openMenu("Analyze");
    expect(screen.getByRole("menuitem", { name: "Fit" })).toHaveAttribute(
      "aria-haspopup",
      "true",
    );
    expect(
      screen.getByRole("menuitem", { name: "Peaks & baseline" }),
    ).toHaveAttribute("aria-haspopup", "true");
    expect(screen.queryByText("Find peaks…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Peaks & baseline" }));
    expect(screen.getByText("Find peaks…")).toBeInTheDocument();
    expect(screen.getByText("Baseline…")).toBeInTheDocument();
  });

  it("still runs a command that sits under a section header", async () => {
    const run = vi.fn();
    const sectioned: Action[] = [
      { id: "cf", group: "Analyze", section: "Fit", label: "Curve fit…", run },
    ];
    render(<MenuBar actions={sectioned} onOpenPalette={vi.fn()} />);
    await openMenu("Analyze");
    fireEvent.click(screen.getByRole("menuitem", { name: "Fit" }));
    fireEvent.click(screen.getByText("Curve fit…"));
    expect(run).toHaveBeenCalledOnce();
  });

  it("supports top-level arrows, popup arrows, and restores focus on Escape", async () => {
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    await warmMenus();
    const file = screen.getByRole("menuitem", { name: "File" });
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    file.focus();
    fireEvent.keyDown(file, { key: "ArrowRight" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "ArrowDown" });
    expect(edit).toHaveAttribute("aria-expanded", "true");
    const popup = screen.getByRole("menu");
    fireEvent.keyDown(popup, { key: "ArrowRight" });
    expect(screen.getByRole("menuitem", { name: "Data" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await pressEscape(document);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Data" })).toHaveFocus();
  });

  it("exposes checked, disabled, and danger state with native menu semantics", async () => {
    const stateful: Action[] = [
      {
        id: "left",
        group: "View",
        label: "Library",
        checked: () => true,
        run: vi.fn(),
      },
      {
        id: "plot",
        group: "View",
        label: "Plot",
        disabled: () => true,
        disabledReason: "Select data first",
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
    render(<MenuBar actions={stateful} onOpenPalette={vi.fn()} />);
    await openMenu("View");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Library" }),
    ).toHaveAttribute("aria-checked", "true");
    const disabledPlot = screen.getByTitle("Select data first");
    expect(disabledPlot).toBeDisabled();
    fireEvent.click(screen.getByText("File"));
    expect(screen.getByRole("menuitem", { name: "Remove all…" })).toHaveClass(
      "danger",
    );
  });
});

// ── ROUND 4 (review of round 3, NIT 7): an open menu OWNS Escape ─────────
// The dispatcher advertises GUI_INTERACTION #9 ("an open menu OWNS Escape")
// and carries a `.qzk-ctx` belt-and-braces guard, but only `ContextMenu` wears
// that class. This menu closed on a plain document-keydown with no
// `preventDefault`/`stopPropagation`, so the shared registry ALSO walked:
// measured, the menu closed AND the armed plot tool reverted to pointer on one
// keystroke. It is a `menu`-layer surface now — the top of the ladder.
describe("MenuBar Escape ownership (P3.3 round 4)", () => {
  it("closes the open menu and claims the key, so nothing below also acts", async () => {
    useApp.setState({ plotTool: "zoom" });
    renderHook(() => useGlobalShortcuts());
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    await openMenu("Analyze");
    expect(screen.getByText("Curve fit…")).toBeInTheDocument();

    await pressEscape(document);

    expect(screen.queryByText("Curve fit…")).not.toBeInTheDocument(); // menu closed…
    expect(useApp.getState().plotTool).toBe("zoom"); // …and ONLY the menu closed

    // The next Escape, with no menu open, reaches the tool-revert tier.
    await pressEscape();
    expect(useApp.getState().plotTool).toBe("pointer");
  });
});
