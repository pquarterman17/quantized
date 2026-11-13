// Origin-replacement audit item 12: a plain click on an Origin book opens it
// in the Worksheet tab WITHOUT changing the active (plotted) dataset
// (`activateFromLibrary`). The title bar and status bar must then name the
// sheet on screen, not the plotted dataset.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";

const data = (n: number) => ({
  time: Array.from({ length: n }, (_, i) => i),
  values: Array.from({ length: n }, () => [1]),
  labels: ["M"],
  units: [""],
  metadata: {},
});

beforeEach(() => {
  useApp.setState({
    currentProject: null,
    datasets: [
      { id: "a", name: "multi:Loop.opj", data: data(3) },
      { id: "b", name: "multi:XRD.opj", data: data(5) },
    ],
    activeId: "a",
    worksheetId: "b",
    stageTab: "worksheet",
  });
});

describe("title + status bar name the dataset the Stage shows", () => {
  it("on the Worksheet tab: the opened sheet (worksheetId)", () => {
    render(
      <>
        <TitleBar />
        <StatusBar />
      </>,
    );
    expect(screen.getByText("multi:XRD")).toBeInTheDocument(); // title (stem)
    expect(screen.getByText(/multi:XRD\.opj · 5 pts · 1 ch/)).toBeInTheDocument();
    expect(screen.queryByText(/multi:Loop/)).not.toBeInTheDocument();
  });

  it("on the Plot tab: the active (plotted) dataset", () => {
    useApp.setState({ stageTab: "plot" });
    render(<StatusBar />);
    expect(screen.getByText(/multi:Loop\.opj · 3 pts · 1 ch/)).toBeInTheDocument();
  });
});
