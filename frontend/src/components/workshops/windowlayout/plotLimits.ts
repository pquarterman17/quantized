// The plot window's own position clamp and minimum size, handed to the
// store-side move helpers (store/windowLayoutMoves.ts), which may not import
// components/.

import type { PlotLimits } from "../../../store/windowLayoutMoves";
import { clampPlotWindowPosition, MIN_PLOT_WINDOW_H, MIN_PLOT_WINDOW_W } from "../../windows/usePlotWindowGesture";

export const PLOT_LIMITS: PlotLimits = { clamp: clampPlotWindowPosition, minW: MIN_PLOT_WINDOW_W, minH: MIN_PLOT_WINDOW_H };
