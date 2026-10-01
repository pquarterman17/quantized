// WAI-ARIA tablist keyboard model, shared by every tab strip (Stage views,
// Preferences, Help). The caller renders roving tabindex (selected tab 0, the
// rest -1) and puts this on the `role="tablist"` element's onKeyDown.
//
// Left/Right always step; Up/Down step only in an `aria-orientation="vertical"`
// list, so a horizontal strip leaves them to the app's dataset keys. Both
// directions wrap; Home/End jump. A modified key is left alone. With
// `activate`, the reached tab is also clicked (automatic activation); without
// it, Enter/Space on the focused <button> selects (manual activation).

import type { KeyboardEvent } from "react";

export function onTabListKeyDown(e: KeyboardEvent<HTMLElement>, activate: boolean): void {
  const list = e.currentTarget;
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
  const n = tabs.length;
  const at = tabs.indexOf(e.target as HTMLElement);
  const k = list.getAttribute("aria-orientation") === "vertical" ? e.key.replace("Down", "Right").replace("Up", "Left") : e.key;
  const to = k === "Home" ? 0 : k === "End" ? n - 1 : k === "ArrowRight" ? at + 1 : k === "ArrowLeft" ? at - 1 + n : -1;
  if (at < 0 || to < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const tab = tabs[to % n];
  tab.focus();
  if (activate) tab.click();
}
