// The 3-D panel's open state, shared by everything that shows or reads it (the
// toolbar's button and overlay, the stage that docks it beside the scene, the 3-D
// view that opens it for a refusal). Starts from the remembered choice (closed the
// first time) and writes every explicit change back; a panel opened BY a refusal
// (`openMap3dPanelFor`) is not remembered, and Close shuts it either way.

import { useSyncExternalStore } from "react";

import { loadMap3dPanelOpen, saveMap3dPanelOpen } from "../../lib/map3dPanelPrefs";

const listeners = new Set<() => void>();
let forced = false; // opened by a refusal: this session only
let held: boolean | null = null; // the choice, when storage cannot keep it
let seen: string | null = null; // the refusal that last opened it: a closed panel stays closed for it

const read = (): boolean => (held ?? loadMap3dPanelOpen()) || forced;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function setMap3dPanelOpen(next: boolean | ((v: boolean) => boolean)): void {
  const value = typeof next === "function" ? next(read()) : next;
  if (value === read()) return;
  forced = false;
  saveMap3dPanelOpen(value);
  held = loadMap3dPanelOpen() === value ? null : value;
  emit();
}

/** Open the panel because the view cannot draw until a setting in it changes; once per refusal. */
export function openMap3dPanelFor(refusal: string): void {
  if (seen === refusal) return;
  seen = refusal;
  if (!read()) {
    forced = true;
    emit();
  }
}

/** The view draws again: the next refusal opens the panel afresh. */
export const map3dPanelSettled = (): void => void (seen = null);

export function useMap3dPanelOpen(): [boolean, typeof setMap3dPanelOpen] {
  return [useSyncExternalStore(subscribe, read), setMap3dPanelOpen];
}
