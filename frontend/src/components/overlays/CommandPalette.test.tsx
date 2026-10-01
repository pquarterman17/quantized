import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommandPalette from "./CommandPalette";
import { useApp } from "../../store/useApp";

const action = {
  id: "break-x-axis",
  group: "Plot",
  label: "Break x-axis at gaps…",
  description: "Detect large gaps and display a discontinuous horizontal axis.",
  run: vi.fn(),
};

beforeEach(() => {
  useApp.setState({ cmdkOpen: true });
});

afterEach(() => {
  useApp.setState({ cmdkOpen: false });
  vi.clearAllMocks();
});

// Residual R2 (PRIMARY_SOFTWARE_AUDIT_PLAN): the palette focused its input and
// never gave focus back, so every close left the user on <body>, where the
// global Delete binding removes the active dataset.
describe("CommandPalette returns focus to its opener (R2)", () => {
  async function openFrom(actions = [action]): Promise<HTMLElement> {
    useApp.setState({ cmdkOpen: false });
    render(
      <>
        <button type="button">Opener</button>
        <CommandPalette actions={actions} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    act(() => useApp.setState({ cmdkOpen: true }));
    const input = screen.getByPlaceholderText("Type a command…");
    await waitFor(() => expect(input).toHaveFocus());
    return opener;
  }

  it("on Escape", async () => {
    const opener = await openFrom();
    fireEvent.keyDown(screen.getByPlaceholderText("Type a command…"), { key: "Escape" });
    expect(useApp.getState().cmdkOpen).toBe(false);
    expect(opener).toHaveFocus();
  });

  it("on running a command, BEFORE the command acts", async () => {
    // Before, not after: a command that opens a dialog must see the real
    // opener as the focused element, or that dialog restores to a dead input.
    let focusedAtRun: Element | null = null;
    const probe = { ...action, run: vi.fn(() => (focusedAtRun = document.activeElement)) };
    const opener = await openFrom([probe]);
    fireEvent.keyDown(screen.getByPlaceholderText("Type a command…"), { key: "Enter" });
    expect(probe.run).toHaveBeenCalledOnce();
    expect(focusedAtRun).toBe(opener);
    expect(opener).toHaveFocus();
  });

  it("on a close from outside the palette (the unmount backstop)", async () => {
    const opener = await openFrom();
    act(() => useApp.setState({ cmdkOpen: false }));
    expect(opener).toHaveFocus();
  });

  it("on a backdrop click", async () => {
    const opener = await openFrom();
    const backdrop = document.querySelector(".qz-overlay-backdrop");
    if (!backdrop) throw new Error("palette backdrop not rendered");
    fireEvent.mouseDown(backdrop);
    expect(useApp.getState().cmdkOpen).toBe(false);
    expect(opener).toHaveFocus();
  });
});

// The context-action registry loads with `import()` (eager-bundle cost), so
// its entries join the list a microtask after the palette opens.
describe("CommandPalette context actions", () => {
  const dataset = { id: "d1", name: "Alpha", data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} } };

  it("lists the active dataset's actions under its own group", async () => {
    useApp.setState({ datasets: [dataset], activeId: "d1", selectedAnnotationId: null, selectedShapeId: null });
    render(<CommandPalette actions={[action]} />);
    const group = await screen.findByRole("group", { name: "Active dataset — Alpha" });
    expect(within(group).getByRole("option", { name: /^Duplicate/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Break x-axis/ })).toBeInTheDocument();
  });

  it("closing and reopening lists each context action once", async () => {
    useApp.setState({ datasets: [dataset], activeId: "d1", selectedAnnotationId: null, selectedShapeId: null });
    render(<CommandPalette actions={[action]} />);
    act(() => useApp.setState({ cmdkOpen: false }));
    act(() => useApp.setState({ cmdkOpen: true }));
    const group = await screen.findByRole("group", { name: "Active dataset — Alpha" });
    expect(within(group).getAllByRole("option", { name: /^Duplicate/ })).toHaveLength(1);
  });
});

describe("CommandPalette discovery descriptions", () => {
  it("shows the concise command outcome below its label", () => {
    render(<CommandPalette actions={[action]} />);
    expect(screen.getByText(action.description)).toBeInTheDocument();
  });

  it("finds a command by words in its description", () => {
    render(<CommandPalette actions={[action]} />);
    fireEvent.change(screen.getByPlaceholderText("Type a command…"), {
      target: { value: "discontinuous" },
    });
    expect(screen.getByText("Break x-axis at gaps…")).toBeInTheDocument();
    expect(screen.queryByText("No matching commands")).not.toBeInTheDocument();
  });
});

// Dialog-basics audit residuals: the palette is a backdrop dialog, so the page
// behind it goes inert through the same registry the other modals use
// (lib/modalInert.ts), and its group headers are group labels, not options.
describe("CommandPalette as a modal listbox", () => {
  function renderWithPage(actions = [action]) {
    useApp.setState({ cmdkOpen: false });
    render(
      <>
        <main>
          <button type="button">Opener</button>
        </main>
        <CommandPalette actions={actions} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    return opener;
  }

  it("makes the page behind it inert while open, and lifts it before focus goes back", async () => {
    const opener = renderWithPage();
    act(() => useApp.setState({ cmdkOpen: true }));
    await waitFor(() => expect(opener.closest("main")).toHaveAttribute("inert"));
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(opener.closest("[inert]")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("labels each run of commands as a group whose header is not an option", () => {
    const actions = [
      action,
      { id: "a2", group: "File", label: "Export figure", run: vi.fn() },
      { id: "a3", group: "File", label: "Export page", run: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    const file = within(listbox).getByRole("group", { name: "File" });
    expect(within(file).getAllByRole("option").map((o) => o.textContent)).toEqual(["Export figure", "Export page"]);
    expect(within(listbox).getByRole("group", { name: "Plot" })).toBeInTheDocument();
    // The header text is the group's name, not a stray item in the listbox.
    for (const header of listbox.querySelectorAll(".qz-cmdk-group")) {
      expect(header).toHaveAttribute("role", "presentation");
      expect(header.closest('[role="group"]')).not.toBeNull();
    }
    // A grouped option still runs on click.
    fireEvent.mouseDown(within(file).getByRole("option", { name: "Export page" }));
    expect(actions[2].run).toHaveBeenCalledTimes(1);
  });
});
