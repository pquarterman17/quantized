// Tiny state bridge so the shared workbook action registry can open a lazy
// read-only dialog without importing its UI into every Library renderer.

import { create } from "zustand";

import type { WorkbookProperties } from "../lib/workbookProperties";

interface WorkbookPropertiesDialogState {
  properties: WorkbookProperties | null;
  open: (properties: WorkbookProperties) => void;
  close: () => void;
}

export const useWorkbookPropertiesDialog = create<WorkbookPropertiesDialogState>((set) => ({
  properties: null,
  open: (properties) => set({ properties }),
  close: () => set({ properties: null }),
}));
