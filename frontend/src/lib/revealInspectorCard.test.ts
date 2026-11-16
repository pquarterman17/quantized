import { afterEach, describe, expect, it } from "vitest";

import { revealInspectorCard } from "./revealInspectorCard";

afterEach(() => {
  document.body.innerHTML = "";
});

function card(title: string): HTMLDetailsElement {
  const d = document.createElement("details");
  d.innerHTML = `<summary><span class="qz-card-heading">${title}</span></summary><div>body</div>`;
  document.body.append(d);
  return d;
}

describe("revealInspectorCard", () => {
  it("opens the titled card and focuses its header, leaving the others alone", async () => {
    const other = card("Axes");
    const target = card("Error columns");
    expect(await revealInspectorCard("Error columns")).toBe(true);
    expect(target.open).toBe(true);
    expect(other.open).toBe(false);
    expect(document.activeElement).toBe(target.querySelector("summary"));
  });

  it("reports a missing card so the caller can say why", async () => {
    card("Axes");
    expect(await revealInspectorCard("Error columns")).toBe(false);
  });
});
