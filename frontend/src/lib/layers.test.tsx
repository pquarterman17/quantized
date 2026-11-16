// The z-index layer model (lib/layers.ts): a modal paints above every tool
// window, a window cannot climb out of its band however often it is clicked,
// and what must stay above a modal (popover, toast, tooltip, menu) does.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CommandPalette from "../components/overlays/CommandPalette";
import ToolWindow from "../components/overlays/ToolWindow";
import { useApp } from "../store/useApp";
import { TOOL_Z_SPAN, Z } from "./layers";
import { resetToolWindowZ } from "./toolWindowZ";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/platform.css"), "utf8");
const cssVar = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)`).exec(css)?.[1]);
const z = (el: Element): number => Number((el as HTMLElement).style.zIndex);
const win = (title: string): HTMLElement => screen.getByRole("dialog", { name: title });

beforeEach(() => {
  resetToolWindowZ();
  useApp.setState({ toolWindowLayout: {}, cmdkOpen: false });
});

describe("layer constants", () => {
  it("are ordered tool < modal < popover < toast < tooltip < menu", () => {
    expect(Z.toolMax).toBeLessThan(Z.fileDrop);
    expect(Z.fileDrop).toBeLessThan(Z.modalBase);
    expect(Z.modalBase + 499).toBeLessThan(Z.modalPopover); // room for 500 stacked modals
    expect(Z.modalPopover).toBeLessThan(Z.toast);
    expect(Z.toast).toBeLessThan(Z.tooltip);
    expect(Z.tooltip).toBeLessThan(Z.menu);
  });

  it("match the CSS custom properties the stylesheet paints with", () => {
    expect(cssVar("z-tool-base")).toBe(Z.toolBase);
    expect(cssVar("z-file-drop")).toBe(Z.fileDrop);
    expect(cssVar("z-modal")).toBe(Z.modalBase);
    expect(cssVar("z-modal-popover")).toBe(Z.modalPopover);
    expect(cssVar("z-toast")).toBe(Z.toast);
    expect(cssVar("z-tooltip")).toBe(Z.tooltip);
    expect(cssVar("z-menu")).toBe(Z.menu);
  });

  it("menus and tooltips stay above modals, which stay above tool windows (stylesheet use)", () => {
    const rule = (sel: string) => new RegExp(`${sel}\\s*\\{[^}]*z-index:\\s*var\\(--(z-[a-z-]+)\\)`).exec(css)?.[1];
    expect(rule("\\.qz-overlay-backdrop")).toBe("z-modal");
    expect(rule("\\.qz-tip")).toBe("z-tooltip");
    expect(rule("\\.qzk-toaster")).toBe("z-toast");
    const dropCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/fileDrop.css"), "utf8");
    expect(/\.qzk-filedrop\s*\{[^}]*z-index:\s*var\(--z-file-drop\)/.test(dropCss)).toBe(true);
  });
});

describe("tool windows", () => {
  it("never leave their band, however many times they are clicked", () => {
    render(
      <>
        <ToolWindow id="a" title="A">a</ToolWindow>
        <ToolWindow id="b" title="B">b</ToolWindow>
      </>,
    );
    const [a, b] = [win("A"), win("B")];
    for (let i = 0; i < 2000; i++) fireEvent.mouseDown(i % 2 ? a : b);
    expect(z(a)).toBeLessThanOrEqual(Z.toolMax);
    expect(z(b)).toBeLessThanOrEqual(Z.toolMax);
    expect(z(a)).toBeGreaterThan(z(b)); // the last click (i = 1999) was on A
    expect(Math.max(z(a), z(b))).toBeLessThan(Z.toolBase + TOOL_Z_SPAN + 1);
  });

  it("a click on the window already on top does not move it", () => {
    render(
      <>
        <ToolWindow id="a" title="A">a</ToolWindow>
        <ToolWindow id="b" title="B">b</ToolWindow>
      </>,
    );
    const before = z(win("B")); // opened last: on top
    for (let i = 0; i < 50; i++) fireEvent.mouseDown(win("B"));
    expect(z(win("B"))).toBe(before);
  });

  it("keep their relative order through a renumber", () => {
    render(
      <>
        <ToolWindow id="a" title="A">a</ToolWindow>
        <ToolWindow id="b" title="B">b</ToolWindow>
        <ToolWindow id="c" title="C">c</ToolWindow>
      </>,
    );
    for (let i = 0; i < 1500; i++) fireEvent.mouseDown(i % 2 ? win("A") : win("B"));
    fireEvent.mouseDown(win("C")); // C last, B before it, A before that
    fireEvent.mouseDown(win("A"));
    expect(z(win("A"))).toBeGreaterThan(z(win("C")));
    expect(z(win("C"))).toBeGreaterThan(z(win("B")));
  });
});

describe("a modal over a tool window", () => {
  it("opens above it, even after the window was clicked a lot (the Rename… / Export bug)", async () => {
    render(
      <>
        <ToolWindow id="sp" title="Signal Processing">body</ToolWindow>
        <CommandPalette actions={[{ id: "x", group: "Plot", label: "Thing", run: vi.fn() }]} />
      </>,
    );
    for (let i = 0; i < 1200; i++) fireEvent.mouseDown(win("Signal Processing"));
    act(() => useApp.setState({ cmdkOpen: true }));
    const backdrop = document.querySelector(".qz-overlay-backdrop");
    if (!backdrop) throw new Error("no backdrop");
    await waitFor(() => expect(z(backdrop)).toBeGreaterThanOrEqual(Z.modalBase));
    expect(z(backdrop)).toBeGreaterThan(z(win("Signal Processing")));
  });
});
