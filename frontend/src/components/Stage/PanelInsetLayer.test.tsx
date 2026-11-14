import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import PanelInsetLayer from "./PanelInsetLayer";

const ORIGINAL = useApp.getState();
afterEach(() => useApp.setState(ORIGINAL, true));

describe("PanelInsetLayer", () => {
  it("renders nothing when there are no panel insets", () => {
    const { container } = render(<PanelInsetLayer />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one box per panel inset", () => {
    useApp.setState({
      panelInsets: [
        { id: "p1", at: [0, 0, 0.3, 0.3], content: { kind: "table", rows: [["1"]] } },
        { id: "p2", at: [0.5, 0.5, 0.3, 0.3], content: { kind: "table", rows: [["2"]] } },
      ],
    });
    const { container } = render(<PanelInsetLayer />);
    expect(container.querySelectorAll('[data-testid="panel-inset-box"]')).toHaveLength(2);
  });
});
