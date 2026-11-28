// A protected sheet in the Library: rename and Move to trash are refused with the reason, through the real row.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RENAME_ACTIVE_EVENT } from "../../lib/renameActive";
import { PROTECTED_NOTICE } from "../../lib/sheetProtection";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askConfirm } from "../overlays/ConfirmDialog";
import DatasetRow from "./DatasetRow";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const locked: Dataset = {
  id: "p",
  name: "sample.dat",
  protectedSheet: true,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
};
const props = { active: false, selected: false, showReorder: false, canMoveUp: false, canMoveDown: false, onFilterTag: () => {} };

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  useApp.setState({ datasets: [locked], activeId: null, selectedIds: [], trash: [], history: [], status: "" });
});

describe("Library row of a protected sheet", () => {
  it("rename is refused with the reason", () => {
    render(<DatasetRow dataset={locked} {...props} />);
    act(() => void window.dispatchEvent(new CustomEvent(RENAME_ACTIVE_EVENT, { detail: { id: "p", hit: false } })));
    const box = screen.getByLabelText('Rename "sample.dat"');
    fireEvent.change(box, { target: { value: "other" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useApp.getState().datasets[0].name).toBe("sample.dat");
    expect(useApp.getState().status).toBe(`sample.dat: ${PROTECTED_NOTICE}`);
  });

  it("Move to trash, even confirmed, is refused: no trash entry and no toast claiming it moved", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    const { container } = render(<DatasetRow dataset={locked} {...props} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Move to trash"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["p"]);
    expect(useApp.getState().trash).toHaveLength(0);
    expect(useApp.getState().status).toBe(`sample.dat: ${PROTECTED_NOTICE}`);
  });
});
