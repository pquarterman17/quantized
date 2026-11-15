// Gap audit 5 #1: Preferences ▸ Plot ▸ "Default graph template".
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_TEMPLATE_KEY, loadDefaultGraphTemplateName } from "../../lib/defaultGraphTemplate";
import { saveGraphTemplate } from "../../lib/figuredoc";
import { useApp } from "../../store/useApp";
import { newGraph, setNewGraphStyler, templateSeeds } from "../../store/windowDefaults";
import { DefaultGraphTemplatePref } from "./DefaultGraphTemplatePref";

const template = (name: string, plotTemplate: string) => ({
  name,
  style: "default",
  overrides: null,
  seriesStyles: null,
  format: { version: 1, series: [], plotTemplate },
});

beforeEach(() => {
  localStorage.clear();
  useApp.setState(useApp.getInitialState(), true);
});
afterEach(() => {
  setNewGraphStyler(null);
  templateSeeds.clear();
});

describe("DefaultGraphTemplatePref", () => {
  it("lists None plus every saved template, and picking one makes it the default", () => {
    saveGraphTemplate(template("Lab", "aps"));
    saveGraphTemplate(template("Talk", "presentation"));
    render(<DefaultGraphTemplatePref />);
    const select = screen.getByLabelText("Default graph template") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["None (built-in look)", "Lab", "Talk"]);
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "Talk" } });
    expect(loadDefaultGraphTemplateName()).toBe("Talk");
    expect(newGraph().plotTemplate).toBe("presentation");
    fireEvent.change(select, { target: { value: "" } });
    expect(loadDefaultGraphTemplateName()).toBeNull();
    expect(newGraph().plotTemplate).toBe("screen");
  });

  it("shows a default whose template is gone as missing, and guides a user with no templates", () => {
    localStorage.setItem(DEFAULT_GRAPH_TEMPLATE_KEY, JSON.stringify("Gone"));
    render(<DefaultGraphTemplatePref />);
    const select = screen.getByLabelText("Default graph template") as HTMLSelectElement;
    expect(select.value).toBe("Gone");
    expect(select.selectedOptions[0].text).toBe("Gone (missing)");
    expect(screen.getByText(/Set as Default for New Graphs/)).toBeTruthy();
  });

  it("review F9: lists a template saved in another window without reopening", () => {
    render(<DefaultGraphTemplatePref />);
    saveGraphTemplate(template("Lab", "aps"));
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "qz.graphTemplates" })));
    const select = screen.getByLabelText("Default graph template") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toContain("Lab");
  });
});
