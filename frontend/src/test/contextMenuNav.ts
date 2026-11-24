// Test helper for context menus whose rarer entries sit in submenus (the
// Library row menus, UX audit 10 P1-7): a flyout renders only while its parent
// is hovered, so finding an entry means opening the submenus one by one.

import { fireEvent, screen } from "@testing-library/react";

type Matcher = string | RegExp;

/** The menu entry with this exact text (or matching this pattern), opening submenus until it appears. */
export function findMenuItem(text: Matcher): HTMLElement {
  const lookup = () => screen.queryAllByRole("menuitem").concat(screen.queryAllByRole("menuitemcheckbox"));
  const matches = (el: HTMLElement) => (typeof text === "string" ? el.textContent === text : text.test(el.textContent ?? ""));
  const hit = () => lookup().find(matches);
  const direct = hit();
  if (direct) return direct;
  for (const wrap of document.querySelectorAll(".qzk-ctx-subwrap")) {
    fireEvent.mouseEnter(wrap);
    const found = hit();
    if (found) return found;
  }
  throw new Error(`no menu entry ${String(text)} (open submenus included)`);
}

/** Click the menu entry, wherever it sits. */
export function clickMenuItem(text: Matcher): void {
  fireEvent.click(findMenuItem(text));
}

/** Every entry's text, with each submenu opened in turn. */
export function allMenuLabels(): string[] {
  const seen = new Set<string>();
  const read = () => screen.queryAllByRole("menuitem").concat(screen.queryAllByRole("menuitemcheckbox")).forEach((el) => seen.add(el.textContent ?? ""));
  read();
  for (const wrap of document.querySelectorAll(".qzk-ctx-subwrap")) {
    fireEvent.mouseEnter(wrap);
    read();
  }
  return [...seen];
}
