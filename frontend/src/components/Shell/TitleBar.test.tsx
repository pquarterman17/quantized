// P1.2 box 1: TitleBar shows the current project's name and a dirty marker
// once a project has a durable identity (a native open/save); a fresh or
// browser-only session shows nothing extra — the pre-P1.2 brand area.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import TitleBar from "./TitleBar";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({
    currentProject: null,
    projectDirty: false,
    datasets: [],
    activeId: null,
  });
});

describe("TitleBar — project identity (P1.2 box 1)", () => {
  it("shows nothing extra when no project has a durable identity yet", () => {
    render(<TitleBar />);
    expect(screen.queryByText(/workspace\.dwk/)).not.toBeInTheDocument();
  });

  it("shows the project name once one is open", () => {
    useApp.setState({ currentProject: { name: "workspace.dwk", path: "/proj/workspace.dwk" } });
    render(<TitleBar />);
    expect(screen.getByText(/workspace\.dwk/)).toBeInTheDocument();
  });

  it("shows a dirty marker when the project has unsaved changes", () => {
    useApp.setState({
      currentProject: { name: "workspace.dwk", path: "/proj/workspace.dwk" },
      projectDirty: true,
    });
    const { container } = render(<TitleBar />);
    expect(container.querySelector(".qzk-project-dirty")).toBeInTheDocument();
  });

  it("shows no dirty marker when the project is clean", () => {
    useApp.setState({
      currentProject: { name: "workspace.dwk", path: "/proj/workspace.dwk" },
      projectDirty: false,
    });
    const { container } = render(<TitleBar />);
    expect(container.querySelector(".qzk-project-dirty")).not.toBeInTheDocument();
  });

  it("carries the full path as a hover title", () => {
    useApp.setState({ currentProject: { name: "workspace.dwk", path: "/proj/nested/workspace.dwk" } });
    const { container } = render(<TitleBar />);
    expect(container.querySelector(".qzk-project")).toHaveAttribute(
      "title",
      "/proj/nested/workspace.dwk",
    );
  });
});
