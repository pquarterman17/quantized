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
    browserFileName: null,
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

describe("TitleBar — browser file name and window title", () => {
  it("shows a browser-opened file's name and titles the document with it", () => {
    useApp.setState({ browserFileName: "MyRun.dwk" });
    render(<TitleBar />);
    expect(screen.getByText(/MyRun\.dwk/)).toBeInTheDocument();
    expect(document.title).toBe("MyRun.dwk — Quantized");
  });

  it("marks unsaved changes in the document title", () => {
    useApp.setState({ currentProject: { name: "MyRun.dwk", path: "/p/MyRun.dwk" }, projectDirty: true });
    render(<TitleBar />);
    expect(document.title).toBe("• MyRun.dwk — Quantized");
  });

  it("UX9-I: centres the project name, ahead of the shown dataset", () => {
    useApp.setState({
      currentProject: { name: "MyRun.dwk", path: "/p/MyRun.dwk" },
      datasets: [{ id: "d", name: "scan.csv", data: { time: [], values: [], labels: [], units: [], metadata: {} } }],
      activeId: "d",
    });
    const { container } = render(<TitleBar />);
    const doc = container.querySelector(".qzk-doc")!;
    expect(doc.querySelector(".qzk-project")?.textContent).toBe("MyRun.dwk");
    expect(doc.textContent).toBe("MyRun.dwk — scan.csv");
  });

  it("is plain 'Quantized' with no project", () => {
    render(<TitleBar />);
    expect(document.title).toBe("Quantized");
  });
});
