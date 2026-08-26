// Error-role override (MAIN_PLAN #36). The behaviours worth pinning: detection
// happens when ASKED (never silently), a one-sided binding is called out rather
// than silently drawing nothing, and removing a binding leaves the column alone.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ErrorRolesCard from "./ErrorRolesCard";
import { useApp } from "../../store/useApp";
import type { Dataset } from "../../lib/types";

const ds = (labels: string[], errorRoles?: Dataset["errorRoles"]): Dataset => ({
  id: "d1",
  name: "r.dat",
  data: {
    time: [0, 1],
    values: [labels.map(() => 1), labels.map(() => 2)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  },
  ...(errorRoles ? { errorRoles } : {}),
});

beforeEach(() => useApp.setState({ datasets: [], activeId: "d1", status: "" }));

describe("ErrorRolesCard", () => {
  it("is hidden for a single-channel dataset", () => {
    const d = ds(["M"]);
    const { container } = render(<ErrorRolesCard active={d} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains itself when nothing is bound", () => {
    render(<ErrorRolesCard active={ds(["M", "dM"])} />);
    expect(screen.getByText(/No error columns bound/)).toBeInTheDocument();
  });

  it("detects bindings only when ASKED", () => {
    const d = ds(["R", "dR"]);
    useApp.setState({ datasets: [d] });
    render(<ErrorRolesCard active={d} />);
    expect(useApp.getState().datasets[0].errorRoles).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /Detect from names/ }));
    expect(useApp.getState().datasets[0].errorRoles).toEqual([
      { channel: 1, target: 0, axis: "y", side: "both" },
    ]);
  });

  it("says so when nothing is recognizable, instead of failing silently", () => {
    const d = ds(["Temp", "Moment"]);
    useApp.setState({ datasets: [d] });
    render(<ErrorRolesCard active={d} />);
    fireEvent.click(screen.getByRole("button", { name: /Detect from names/ }));
    expect(useApp.getState().status).toContain("no error columns recognized");
  });

  it("WARNS about a one-sided binding rather than drawing nothing quietly", () => {
    const roles: Dataset["errorRoles"] = [{ channel: 1, target: 0, axis: "y", side: "+" }];
    const d = ds(["M", "up"], roles);
    useApp.setState({ datasets: [d] });
    render(<ErrorRolesCard active={d} />);
    expect(screen.getByRole("alert")).toHaveTextContent("needs BOTH halves");
  });

  it("does not warn once both halves are present", () => {
    const roles: Dataset["errorRoles"] = [
      { channel: 1, target: 0, axis: "y", side: "+" },
      { channel: 2, target: 0, axis: "y", side: "-" },
    ];
    const d = ds(["M", "up", "dn"], roles);
    useApp.setState({ datasets: [d] });
    render(<ErrorRolesCard active={d} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes a binding without touching the column's data", () => {
    const roles: Dataset["errorRoles"] = [{ channel: 1, target: 0, axis: "y", side: "both" }];
    const d = ds(["M", "dM"], roles);
    useApp.setState({ datasets: [d] });
    render(<ErrorRolesCard active={d} />);
    fireEvent.click(screen.getByRole("button", { name: /Remove error role/ }));
    const after = useApp.getState().datasets[0];
    // Round 7 (BLOCKER 2): removing the LAST binding is a deliberate
    // setErrorRoles(id, []) — the O1 "checked: none" marker, not "never
    // determined" — so it must persist as `[]`, not collapse to
    // `undefined` and re-invite a `?? inferErrorBindings(...)` re-guess.
    expect(after.errorRoles).toEqual([]);
    expect(after.data.values).toEqual(d.data.values); // a reference, not a rewrite
  });

  it("re-points a binding to a different axis", () => {
    const roles: Dataset["errorRoles"] = [{ channel: 1, target: 0, axis: "y", side: "both" }];
    const d = ds(["M", "dM"], roles);
    useApp.setState({ datasets: [d] });
    render(<ErrorRolesCard active={d} />);
    const axis = screen.getByTitle(/horizontally/) as HTMLSelectElement;
    fireEvent.change(axis, { target: { value: "x" } });
    expect(useApp.getState().datasets[0].errorRoles?.[0].axis).toBe("x");
  });
});
