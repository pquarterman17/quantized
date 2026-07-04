import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ParamDialog from "../overlays/ParamDialog";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import BookFamiliesSection from "./BookFamiliesSection";

const book = (id: string, name: string, originBook: string): Dataset => ({
  id,
  name,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: { origin_book: originBook } },
});

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
});

describe("BookFamiliesSection", () => {
  it("renders nothing without a multi-book Origin family", () => {
    useApp.setState({ datasets: [book("b1", "XRD:Book1", "Book1")] });
    const { container } = render(<BookFamiliesSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a detected family with its book count", () => {
    useApp.setState({
      datasets: [book("b1", "XRD:Book1", "Book1"), book("b2", "XRD:Book2", "Book2")],
    });
    render(<BookFamiliesSection />);
    expect(screen.getByText("XRD")).toBeInTheDocument();
    expect(screen.getByText("2 books")).toBeInTheDocument();
  });

  it("removes exactly the unchecked books on confirm", async () => {
    useApp.setState({
      datasets: [
        book("b1", "XRD:Book1", "Book1"),
        book("b2", "XRD:Book2", "Book2"),
        book("b3", "XRD:Book3", "Book3"),
      ],
    });
    render(
      <>
        <BookFamiliesSection />
        <ParamDialog />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    fireEvent.click(checkboxes[1]); // uncheck Book2
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b1", "b3"]);
    });
  });

  it("leaves the library untouched when the dialog is cancelled", async () => {
    useApp.setState({
      datasets: [book("b1", "XRD:Book1", "Book1"), book("b2", "XRD:Book2", "Book2")],
    });
    render(
      <>
        <BookFamiliesSection />
        <ParamDialog />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    await screen.findAllByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useApp.getState().datasets).toHaveLength(2);
  });
});
