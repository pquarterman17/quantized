// Forces the Column list's first-paint race (the flake "a rename on a protected sheet is refused with
// the reason", seen once in CI): a gesture that lands right after the window commits, before React has
// run the mount's passive effects. A reset-on-mount effect then replays the OLD value over the typed
// draft, so Enter saw `draft === value` and committed nothing. The MutationObserver callback runs in the
// microtask right after the commit, ahead of the passive-effect task, so this hits that window on every run.

import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { closeSheetStructure, openColumnList } from "./openSheetStructure";

const mk = (protectedSheet: boolean): Dataset => ({
  id: "w",
  name: "Run 1",
  ...(protectedSheet ? { protectedSheet: true } : {}),
  data: { time: [0, 1, 2], values: [[3, 30], [1, 10], [2, 20]], labels: ["Temp", "Field"], units: ["K", "Oe"], metadata: {} },
});

/** Open the Column list and run `act` on the Name input in the same tick the window is first committed. */
function typeIntoFreshWindow(act: (el: HTMLInputElement) => void): Promise<void> {
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      const el = document.querySelector<HTMLInputElement>('[aria-label="Name, column A"]');
      if (!el) return;
      mo.disconnect();
      act(el);
      resolve();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    openColumnList("w");
  });
}

const rename = (el: HTMLInputElement): void => {
  fireEvent.change(el, { target: { value: "Renamed" } });
  fireEvent.keyDown(el, { key: "Enter" });
};

describe("Column list: a rename typed on the first committed frame", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [mk(false)], activeId: "w", history: [], future: [], status: "", statusDanger: null } as Partial<ReturnType<typeof useApp.getState>>);
  });
  afterEach(() => closeSheetStructure("column-list"));

  it("on a protected sheet is refused with the reason", async () => {
    useApp.setState({ datasets: [mk(true)] });
    await typeIntoFreshWindow(rename);
    expect(useApp.getState().datasets[0].data.labels[0]).toBe("Temp");
    expect(useApp.getState().status).toMatch(/protected/i);
  });

  it("on an editable sheet commits", async () => {
    await typeIntoFreshWindow(rename);
    expect(useApp.getState().datasets[0].data.labels[0]).toBe("Renamed");
  });

  it("keeps what the user typed when the same value is re-read, and resyncs when the sheet's value changes", async () => {
    let el!: HTMLInputElement;
    await typeIntoFreshWindow((e) => {
      el = e;
      fireEvent.change(e, { target: { value: "Draft" } });
    });
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0] }] }); // new object, same text
    await new Promise((r) => setTimeout(r, 0));
    expect(el.value).toBe("Draft");
    useApp.setState({ datasets: [{ ...mk(false), data: { ...mk(false).data, labels: ["Other", "Field"] } }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(el.value).toBe("Other");
  });
});
