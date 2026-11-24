// UX menus audit N9: right-click on empty Library space opens New folder / Import.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useLibraryBackgroundMenu } from "./useLibraryBackgroundMenu";

function Host({ onNewFolder, onImport }: { onNewFolder: () => void; onImport: () => void }) {
  const m = useLibraryBackgroundMenu(onNewFolder, onImport);
  return (
    <aside onContextMenu={m.onContextMenu}>
      {m.node}
      <div data-testid="empty">empty space</div>
      <div data-testid="row" onContextMenu={(e) => e.preventDefault()}>a row with its own menu</div>
      <input aria-label="search" />
    </aside>
  );
}

describe("Library background menu", () => {
  it("opens on empty space and runs its items", async () => {
    const onNewFolder = vi.fn();
    render(<Host onNewFolder={onNewFolder} onImport={vi.fn()} />);
    expect(fireEvent.contextMenu(screen.getByTestId("empty"))).toBe(false);
    fireEvent.click(await screen.findByRole("menuitem", { name: "New folder" }));
    expect(onNewFolder).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Import data…" })).toBeNull(); // closed after a pick
  });

  it("yields to a row's own menu and to the search field", () => {
    render(<Host onNewFolder={vi.fn()} onImport={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(screen.queryByRole("menuitem", { name: "New folder" })).toBeNull();
    expect(fireEvent.contextMenu(screen.getByLabelText("search"))).toBe(true);
  });
});
