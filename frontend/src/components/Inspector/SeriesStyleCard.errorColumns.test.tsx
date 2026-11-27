// C4 (acceptance pass 4): the series card's "Error bars" box and Box mode must
// follow the error column the plot DRAWS, whichever card bound it -- the
// Channels "±" pick (errKeys + roles) or Inspector > Error columns (roles only).

import { fireEvent, render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesStyleCard from "./SeriesStyleCard";

const DS: Dataset = {
  id: "d1",
  name: "ds",
  data: {
    time: [0, 1, 2], values: [[1, 0.1, 5], [2, 0.1, 6], [3, 0.1, 7]],
    labels: ["Y", "Y err", "Other"], units: ["", "", ""], metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({ datasets: [DS], activeId: "d1", errKeys: {}, seriesStyles: {}, history: [], future: [] });
});

function row0(): HTMLElement {
  return document.querySelector("#series-style-0") as HTMLElement;
}

describe("SeriesStyleCard error bars follow the Error columns card", () => {
  it("is checked and enabled when the Y error was bound only through error roles", () => {
    // The real store action Inspector > Error columns calls; errKeys stays empty.
    useApp.getState().setErrorRoles("d1", [{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(useApp.getState().errKeys).toEqual({});
    render(<SeriesStyleCard active={useApp.getState().datasets[0]} />);
    fireEvent.click(row0().querySelector("summary") as HTMLElement);
    const box = within(row0()).getByRole("checkbox", { name: "Error bars" });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    expect(within(row0()).getByRole("radio", { name: /^Box/ })).toBeInTheDocument(); // Box mode needs the error bound
  });

  it("is off and disabled when nothing is bound", () => {
    render(<SeriesStyleCard active={DS} />);
    const box = within(row0()).getByRole("checkbox", { name: "Error bars" });
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
    expect(within(row0()).queryByRole("radio", { name: /^Box/ })).toBeNull();
  });

  it("unticking clears the role binding too, so the bars really go away", () => {
    useApp.getState().setErrorRoles("d1", [{ channel: 1, target: 0, axis: "y", side: "both" }]);
    const { rerender } = render(<SeriesStyleCard active={useApp.getState().datasets[0]} />);
    fireEvent.click(within(row0()).getByRole("checkbox", { name: "Error bars" }));
    expect(useApp.getState().datasets[0].errorRoles).toEqual([]);
    expect(useApp.getState().errKeys).toEqual({});
    rerender(<SeriesStyleCard active={useApp.getState().datasets[0]} />);
    expect(within(row0()).getByRole("checkbox", { name: "Error bars" })).not.toBeChecked();
  });

  it("a pick made through the legacy errKeys alone is still honoured", () => {
    useApp.setState({ errKeys: { 0: 1 } });
    render(<SeriesStyleCard active={DS} />);
    expect(within(row0()).getByRole("checkbox", { name: "Error bars" })).toBeChecked();
  });
});
